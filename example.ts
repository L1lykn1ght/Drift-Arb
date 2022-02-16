require('dotenv').config()
import { ftx, Order } from 'ccxt'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
	BN,
	Wallet,
	calculateMarkPrice,
	calculateEstimatedFundingRate,
	ClearingHouse,
	PythClient,
	initialize,
	Markets,
	PositionDirection,
	convertToNumber,
	MARK_PRICE_PRECISION
} from '@drift-labs/sdk'
import { sleep, updateNumber, baseAssets } from './libs/lib'
import { question, keyInSelect, keyInYN } from 'readline-sync'

const QUOTE_PRECISION = 10 ** 6


// ---------------------------------------------------------------------------


// receive input about token, lot amount, and max count

let index = keyInSelect(baseAssets, 'Select Base Asset')
const baseAsset = baseAssets[index]

if (index === -1) { process.exit(0) }


let tmpAmount = question(`Enter amount of ${baseAssets[index]} per tx (in number): `)
let amount = parseFloat(tmpAmount)

if (isNaN(amount)) {
    console.log('Type in number!')
    process.exit(0)
}


let tmpLimit = question(`Enter max count (in number): `)
let limit = parseFloat(tmpLimit)

if (isNaN(limit)) {
	console.log('Type in number!')
	process.exit(0)
}


if (keyInYN(`Max position size is ${amount * limit} ${baseAsset}, is this right?`)) {
	console.log('Bot starts running')
} else {
	process.exit(0)
}


// ---------------------------------------------------------------------------


// initial setting

// solana, drift setting
const connection = new Connection(process.env.RPCendpoint, 'processed')

const keypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(process.env.secretKey))
)
const wallet = new Wallet(keypair)

const sdkConfig = initialize({ env: 'mainnet-beta' })
const clearingHouseProgramId = new PublicKey(sdkConfig.CLEARING_HOUSE_PROGRAM_ID)

// ccxt FTX client
const client = new ftx({
	apiKey: process.env.apiKey,
	secret: process.env.secret
})

let diff1 = 0.25
let diff2 = 0.25


// ---------------------------------------------------------------------------


const main = async (baseAsset: string) => {
	// create clearingHouse instance
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHouseProgramId
	)
	await clearingHouse.subscribe()

	const updateNum = updateNumber['ftx'][baseAsset]
	const symbol = baseAsset + '-PERP'
	const MarketInfo = Markets.find((market) => market.baseAssetSymbol === baseAsset)

	// If true, placing FTX limit order
	let flagFTXBuy = true
	let flagFTXSell = true

	// If true, executing drift order
	let flagDriftSell = false
	let flagDriftBuy = false

	// OrderID of FTX limit order
	let orderIDBuy: string
	let orderIDSell: string

	// Price of FTX limit order
	let ftxPriceBuy: number
	let ftxPriceSell: number

	let tx: Order

	// condition of FTX limit order
	let statusBuy: string
	let statusSell: string
	let remainingBuy = amount
	let remainingSell = amount

	// -limit <= count <= limit
	let count = 0

	// If drift order is not confirmed in 30 seconds, errCount += 1
	// If errCount == 2, (stopCount += 1 and consider the order as executed(i.e break))
	// If stopCount == 10, crash
	let errCount = 0
	let stopCount = 0


	// place limit order (FTX)
	const makeFTXOrder = async (side: Order['side'], amount: number, price: number) => {
		while (true) {
			try {
				tx = await client.createLimitOrder(symbol, side, amount, price)
				if (side == 'buy') {
					orderIDBuy = tx['id']
				} else {
					orderIDSell = tx['id']
				}
				break
			} catch (e) {}
		}
	}


	// make drift order
	const makeDriftOrder = async (side: Order['side'], driftPrice: number) => {
		let direction = side == 'buy' ? PositionDirection.LONG : PositionDirection.SHORT

		while (true) {
			try {
				await clearingHouse.openPosition(
					direction,
					new BN(driftPrice * amount * QUOTE_PRECISION),
					MarketInfo.marketIndex
				)
				break
			} catch (e) {
				console.log(e.message)

				if (e.message.indexOf('It is unknown if it succeeded or failed.') !== -1) {
					let words = e.message.split(' ')
					let info = await connection.getSignatureStatus(words[17], { searchTransactionHistory: true })

					if (info.value) {
						break
					} else {
						errCount += 1
					}
				}

				if (errCount === 2) {
					stopCount += 1
					console.log('pass')
					break
				}
			}
		}
	}


	// When count reaches zero, check if all positions are closed.
	const closeAllPositions = async () => {
		// close drift position
		try {
			await clearingHouse.closePosition(
				MarketInfo.marketIndex
			)
		} catch (e) {
			console.log(e.message)

			if (e.message.indexOf('It is unknown if it succeeded or failed.') !== -1) {
				console.log('pass')
			}
		}

		//close FTX position
		while (true) {
			try {
				let positions = await client.fetchPositions()

				for (let position of positions) {
					if (position['symbol'] === symbol) {
			
						if (Number(position['info']['size']) !== 0) {
							let closeAmount = position['info']['size']
							let closeSide: ('buy' | 'sell') = position['side'] === 'long' ? 'sell' : 'buy'

							await client.createMarketOrder(symbol, closeSide, closeAmount)
						}
					}
				}

				break
			} catch (e) {}
		}
	}


	// Main loop
	while (true) {

		let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
		let currentMarketPrice = calculateMarkPrice(MarketAccount)
		let driftPrice = convertToNumber(currentMarketPrice, MARK_PRICE_PRECISION)
		
		// FTX buy Drift sell
		if (count < limit) {
			// place FTX buy limit order
			if (flagFTXBuy) {
				flagFTXBuy = false
				ftxPriceBuy = driftPrice * (100 - diff1) / 100
				await makeFTXOrder('buy', remainingBuy, ftxPriceBuy)
			}

			// get FTX limit order status
			while (true) {
				try {
					tx = await client.fetchOrder(orderIDBuy, symbol)
					statusBuy = tx['status']
					remainingBuy = tx['remaining']
					break
				} catch (e) {}
			}

			if (statusBuy === 'closed') {
				console.log('FTX order executed')
				flagDriftSell = true
				remainingBuy = amount
			
			} else if (statusBuy === 'canceled') {
				flagFTXBuy = true

			} else {
				let tmpFTXPrice1 = driftPrice * (100 - diff1) / 100

				if (Math.abs(tmpFTXPrice1 - ftxPriceBuy) >= updateNum) {
					try {
						ftxPriceBuy = tmpFTXPrice1
						tx = await client.editOrder(orderIDBuy, symbol, 'limit', 'buy', remainingBuy, ftxPriceBuy)
						orderIDBuy = tx['id']
					} catch (e) {}
				}
			}

			// execute drift sell order
			if (flagDriftSell) {
				flagDriftSell = false
				flagFTXBuy = true
				await makeDriftOrder('sell', driftPrice)

				if (stopCount === 10) {
					console.log('stop')
					process.exit(0)
				}
				
				count += 1
				errCount = 0
				console.log('Drift order executed')
				console.log(`Count: ${count}, Position Amount: ${Math.abs(amount * count)} ${baseAsset}`)

				// Make sure that both FTX and Drift positions are closed
				if (count === 0) {
					await closeAllPositions()
				}
			}
		}

		// FTX sell Drift buy
		if (-limit < count) {
			// place FTX sell limit order
			if (flagFTXSell) {
				flagFTXSell = false
				ftxPriceSell = driftPrice * (100 + diff2) / 100
				await makeFTXOrder('sell', remainingSell, ftxPriceSell)
			}

			// get FTX limit order status
			while (true) {
				try {
					tx = await client.fetchOrder(orderIDSell, symbol)
					statusSell = tx['status']
					remainingSell = tx['remaining']
					break
				} catch (e) {}
			}
			
			if (statusSell === 'closed') {
				console.log('FTX order executed')
				flagDriftBuy = true
				remainingSell = amount
			
			} else if (statusSell === 'canceled') {
				flagFTXSell = true
			
			} else {
				let tmpFTXPrice2 = driftPrice * (100 + diff2) / 100

				if (Math.abs(tmpFTXPrice2 - ftxPriceSell) >= updateNum) {
					try {
						ftxPriceSell = tmpFTXPrice2
						tx = await client.editOrder(orderIDSell, symbol, 'limit', 'sell', remainingSell, ftxPriceSell)
						orderIDSell = tx['id']
					} catch (e) {}
				}
			}

			// execute drift buy order
			if (flagDriftBuy) {
				flagDriftBuy = false
				flagFTXSell = true
				await makeDriftOrder('buy', driftPrice)

				if (stopCount === 10) {
					console.log('stop')
					process.exit(0)
				}
				
				count -= 1
				errCount = 0
				console.log('Drift order executed')
				console.log(`Count: ${count}, Position Amount: ${Math.abs(amount * count)} ${baseAsset}`)

				if (count === 0) {
					await closeAllPositions()
				}
			}
		}

		// await sleep(100)
	}
}


const check = async (baseAsset: string, base: number, delta: number) => {
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHouseProgramId
	)
	await clearingHouse.subscribe()

	const pythClient = new PythClient(connection)

	const symbol = baseAsset + '-PERP'
	const MarketInfo = Markets.find((market) => market.baseAssetSymbol === baseAsset)
	
	while (true) {
		while (true) {
			try {
				let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
				let FundingRateDrift = convertToNumber(
					await calculateEstimatedFundingRate(MarketAccount, await pythClient.getPriceData(MarketAccount.amm.oracle), new BN(1), "interpolated")
				)
		
				let info = await client.fetchFundingRate(symbol)
				let FundingRateFTX = 100 * info.fundingRate

				let num = FundingRateFTX - FundingRateDrift

				if (num <= -0.01) {
					diff1 = base + delta * 4
					diff2 = base - delta * 2
				} else if (-0.01 < num && num < -0.005) {
					diff1 = base + delta * 2
					diff2 = base - delta
				} else if (-0.005 <= num && num <= 0.005) {
					diff1 = base
					diff2 = base
				} else if (0.005 < num && num < 0.01) {
					diff1 = base - delta
					diff2 = base + delta * 2
				} else {
					diff1 = base - delta * 2
					diff2 = base + delta * 4
				}

				break
			} catch(e) {}
		}

		await sleep(600000)
	}
}


// ---------------------------------------------------------------------------


main(baseAsset)
check(baseAsset, 0.25, 0.05)
