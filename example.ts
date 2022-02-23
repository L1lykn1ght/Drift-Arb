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
import { sleep, updateNumber, input, ftxLimitOrder, Side } from './libs/lib'

const QUOTE_PRECISION = 10 ** 6


// -------------------------- initial setting ---------------------------------


// receive input about token, lot amount, and max count
let [baseAsset, amount, limit] = input()


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


// ---------------------------------------------------------------------------


const main = async (baseAsset: string) => {

	// create clearingHouse instance
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHouseProgramId
	)
	await clearingHouse.subscribe()

	// When I try to edit order with the same price in FTX,
	// FTX cli returns an error, so I set the updateNum
	const updateNum = updateNumber['ftx'][baseAsset]
	const symbol = baseAsset + '-PERP'
	const MarketInfo = Markets.find((market) => market.baseAssetSymbol === baseAsset)

	// If true, execute order.
	let flag = {
		ftxBuy: true,
		ftxBuyInit: true,
		ftxSell: true,
		ftxSellInit: true,
		driftBuy: false,
		driftSell: false
	}

	let ftxLimitOrderBuy: ftxLimitOrder
	let ftxLimitOrderSell: ftxLimitOrder

	let tx: Order

	// When making FTX buy Drift sell position, count += 1
	// When making FTX sell Drift buy position, count -= 1
	// and -limit <= count <= limit
	let count = 0

	// % difference between FTX price and drift price to initiate a position
	// higher is likely more profitable but less opportunities
	let diffBuy = 0.25
	let diffSell = 0.25

	// If drift order is not confirmed in 30 seconds, errCount += 1
	// If errCount == 2, (stopCount += 1 and consider the order as executed(i.e break))
	// If stopCount == 10, crash
	let errCount = 0
	let stopCount = 0


	// place limit order
	const makeFTXOrder = async (side: Side, price: number) => {
		while (true) {
			try {
				if (side == 'buy') {
					let tmpAmount = flag.ftxBuyInit ? amount : ftxLimitOrderBuy.remaining
					tx = await client.createLimitOrder(symbol, side, tmpAmount, price)
					ftxLimitOrderBuy = {
						status: 'open',
						orderId: tx['id'],
						price,
						remaining: tmpAmount
					}

					flag.ftxBuy = false
					flag.ftxBuyInit = false
				} else {
					let tmpAmount = flag.ftxSellInit ? amount : ftxLimitOrderSell.remaining
					tx = await client.createLimitOrder(symbol, side, tmpAmount, price)
					ftxLimitOrderSell = {
						status: 'open',
						orderId: tx['id'],
						price,
						remaining: tmpAmount
					}

					flag.ftxSell = false
					flag.ftxSellInit = false
				}
				break
			} catch (e) {}
		}
	}


	// edit limit order
	const editFTXOrder = async (side: Side, price: number) => {
		while (true) {
			try {
				if (side == 'buy') {
					tx = await client.editOrder(ftxLimitOrderBuy.orderId, symbol, 'limit', side, ftxLimitOrderBuy.remaining, price)
					ftxLimitOrderBuy.orderId = tx['id']
					ftxLimitOrderBuy.price = price
				} else {
					tx = await client.editOrder(ftxLimitOrderSell.orderId, symbol, 'limit', side, ftxLimitOrderSell.remaining, price)
					ftxLimitOrderSell.orderId = tx['id']
					ftxLimitOrderSell.price = price
				}
				break
			} catch (e) {}
		}
	}


	// fetch limit order
	const fetchFTXOrder = async (side: Side) => {
		while (true) {
			try {
				if (side == 'buy') {
					tx = await client.fetchOrder(ftxLimitOrderBuy.orderId, symbol)
					ftxLimitOrderBuy.status = tx['status']
					ftxLimitOrderBuy.remaining = tx['remaining']
				} else {
					tx = await client.fetchOrder(ftxLimitOrderSell.orderId, symbol)
					ftxLimitOrderSell.status = tx['status']
					ftxLimitOrderSell.remaining = tx['remaining']
				}
				break
			} catch (e) {}
		}
	}


	// make drift order
	const makeDriftOrder = async (side: Side, driftPrice: number) => {
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

				// if tx is not confirmed in 30 seconds, check if tx is succeeded or failed
				if (e.message.indexOf('It is unknown if it succeeded or failed.') !== -1) {
					let words = e.message.split(' ')
					let info = await connection.getSignatureStatus(words[17], { searchTransactionHistory: true })

					// if succeeded, break
					// else retry (errCount += 1)
					if (info.value) {
						break
					} else {
						errCount += 1
					}
				}

				// if errCount == 2, skip
				if (errCount === 2) {
					stopCount += 1
					console.log('pass')
					break
				}
			}
		}

		errCount = 0
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
	const loop = async () => {

		while (true) {
			let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
			let currentMarketPrice = calculateMarkPrice(MarketAccount)
			let driftPrice = convertToNumber(currentMarketPrice, MARK_PRICE_PRECISION)
			
			// make FTX buy Drift sell position
			if (count < limit) {

				// place FTX buy limit order
				if (flag.ftxBuy) {
					let price = driftPrice * (100 - diffBuy) / 100
					await makeFTXOrder('buy', price)
				}
	
				// fetch FTX buy limit order
				await fetchFTXOrder('buy')
	
				if (ftxLimitOrderBuy.status === 'closed') {
					console.log('FTX order executed')
					flag.driftSell = true
					flag.ftxBuyInit = true
				
				} else if (ftxLimitOrderBuy.status === 'canceled') {
					flag.ftxBuy = true
	
				} else {
					let tmpFTXPrice1 = driftPrice * (100 - diffBuy) / 100
	
					if (Math.abs(tmpFTXPrice1 - ftxLimitOrderBuy.price) >= updateNum) {
						let price = tmpFTXPrice1
						await editFTXOrder('buy', price)
					}
				}
	
				// execute drift sell order
				if (flag.driftSell) {
					flag.driftSell = false
					flag.ftxBuy = true
					await makeDriftOrder('sell', driftPrice)

					// Stop because long position may not be equal to short one.
					if (stopCount === 10) {
						console.log('stop')
						process.exit(0)
					}
					
					count += 1
					console.log('Drift order executed')
					console.log(`Count: ${count}, Position Amount: ${Math.abs(amount * count)} ${baseAsset}`)
	
					// Make sure that both FTX and Drift positions are closed
					if (count === 0) {
						await closeAllPositions()
					}
				}
			}
	
			// make FTX sell Drift buy position
			if (-limit < count) {

				// place FTX sell limit order
				if (flag.ftxSell) {
					let price = driftPrice * (100 + diffSell) / 100
					await makeFTXOrder('sell', price)
				}
	
				// fetch FTX sell limit order
				await fetchFTXOrder('sell')
				
				if (ftxLimitOrderSell.status === 'closed') {
					console.log('FTX order executed')
					flag.driftBuy = true
					flag.ftxSellInit = true
				
				} else if (ftxLimitOrderSell.status === 'canceled') {
					flag.ftxSell = true
				
				} else {
					let tmpFTXPrice2 = driftPrice * (100 + diffSell) / 100
	
					if (Math.abs(tmpFTXPrice2 - ftxLimitOrderSell.price) >= updateNum) {
						let price = tmpFTXPrice2
						await editFTXOrder('sell', price)
					}
				}
	
				// execute drift buy order
				if (flag.driftBuy) {
					flag.driftBuy = false
					flag.ftxSell = true
					await makeDriftOrder('buy', driftPrice)

					// Stop because long position may not be equal to short one.
					if (stopCount === 10) {
						console.log('stop')
						process.exit(0)
					}
					
					count -= 1
					console.log('Drift order executed')
					console.log(`Count: ${count}, Position Amount: ${Math.abs(amount * count)} ${baseAsset}`)

					// Make sure that both FTX and Drift positions are closed
					if (count === 0) {
						await closeAllPositions()
					}
				}
			}
	
			// await sleep(100)
		}
	}


	// check Funding Rate and adjust diff
	const check = async (base: number, delta: number) => {
		const pythClient = new PythClient(connection)
		
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
						diffBuy = base + delta * 4
						diffSell = base - delta * 2
					} else if (-0.01 < num && num < -0.005) {
						diffBuy = base + delta * 2
						diffSell = base - delta
					} else if (-0.005 <= num && num <= 0.005) {
						diffBuy = base
						diffSell = base
					} else if (0.005 < num && num < 0.01) {
						diffBuy = base - delta
						diffSell = base + delta * 2
					} else {
						diffBuy = base - delta * 2
						diffSell = base + delta * 4
					}
	
					break
				} catch(e) {}
			}

			// sleep 10 min
			await sleep(600000)
		}
	}
	

	loop()
	check(0.25, 0.05)
}


// ---------------------------------------------------------------------------


main(baseAsset)
