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
import { sleep, updateNumber } from './libs/lib'

const QUOTE_PRECISION = 10 ** 6


// ---------------------------------------------------------------------------


const connection = new Connection(process.env.RPCendpoint, 'processed')
const keypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(process.env.secretKeyMain))
)
const wallet = new Wallet(keypair)
const sdkConfig = initialize({ env: 'mainnet-beta' })
const clearingHousePublicKey = new PublicKey(sdkConfig.CLEARING_HOUSE_PROGRAM_ID)
const client = new ftx({
	apiKey: process.env.apiKeyMain,
	secret: process.env.secretMain
})


// ---------------------------------------------------------------------------


const baseAsset = 'LUNA'
const symbol = baseAsset + '-PERP'
const MarketInfo = Markets.find((market) => market.baseAssetSymbol === baseAsset)

const amount = 5
const limit = 60
const updateNum = updateNumber.ftx.LUNA
let kairi1 = 0.27
let kairi2 = 0.27



// ---------------------------------------------------------------------------


const main = async () => {
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHousePublicKey
	)
	await clearingHouse.subscribe()

	let flag1 = false
	let flag2 = false
	let flagOrder1 = true
	let flagOrder2 = true

	let orderID1: string
	let orderID2: string
	let ftxPrice1: number
	let ftxPrice2: number

	let tx: Order
	let status1: string
	let status2: string
	let remaining1 = amount
	let remaining2 = amount

	let count = 0
	let errCount = 0
	let stopCount = 0

	// Main loop
	while (true) {

		let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
		let currentMarketPrice = calculateMarkPrice(MarketAccount)
		let driftPrice = convertToNumber(currentMarketPrice, MARK_PRICE_PRECISION)
		
		// FTX long Drift short
		if (count < limit) {
			if (flagOrder1) {
				flagOrder1 = false
				ftxPrice1 = driftPrice * (100 - kairi1) / 100
				while (true) {
					try {
						tx = await client.createLimitBuyOrder(symbol, remaining1, ftxPrice1)
						orderID1 = tx['id']
						break
					} catch (e) {}
				}
			}

			while (true) {
				try {
					tx = await client.fetchOrder(orderID1, symbol)
					status1 = tx['status']
					remaining1 = tx['remaining']
					break
				} catch (e) {}
			}

			if (status1 === 'closed') {
				console.log('ftxでの約定確認')
				flag1 = true
				remaining1 = amount
			
			} else if (status1 === 'canceled') {
				flagOrder1 = true

			} else {
				let tmpFTXPrice1 = driftPrice * (100 - kairi1) / 100

				if (Math.abs(tmpFTXPrice1 - ftxPrice1) >= updateNum) {
					try {
						ftxPrice1 = tmpFTXPrice1
						tx = await client.editOrder(orderID1, symbol, 'limit', 'buy', remaining1, ftxPrice1)
						orderID1 = tx['id']
					} catch (e) {}
				}
			}

			if (flag1) {
				while (true) {
					try {
						await clearingHouse.openPosition(
							PositionDirection.SHORT,
							new BN(driftPrice * amount * QUOTE_PRECISION),
							MarketInfo.marketIndex
						)
						errCount = 0
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

				if (stopCount === 10) {
					console.log('stop')
					process.exit(0)
				}
				
				console.log('driftでの約定確認')
				console.log(`Count: ${count}, Position Amount: ${amount * count} ${baseAsset}`)

				count += 1
				flag1 = false
				flagOrder1 = true
				errCount = 0

				if (count === 0) {
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

					while (true) {
						try {
							let positions = await client.fetchPositions()

							for (let position of positions) {
								if (position['symbol'] === symbol){
						
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
			}
		}

		// FTX short Drift long
		if (-limit < count) {
			if (flagOrder2) {
				flagOrder2 = false
				while (true) {
					try {
						tx = await client.createLimitSellOrder(symbol, remaining2, ftxPrice2)
						orderID2 = tx['id']
						break
					} catch (e) {}
				}
			}

			while (true) {
				try {
					tx = await client.fetchOrder(orderID2, symbol)
					status2 = tx['status']
					remaining2 = tx['remaining']
					break
				} catch (e) {}
			}
			
			if (status2 === 'closed') {
				console.log('ftxでの約定確認')
				flag2 = true
				remaining2 = amount
			
			} else if (status2 === 'canceled') {
				flagOrder2 = true
			
			} else {
				let tmpFTXPrice2 = driftPrice * (100 + kairi2) / 100

				if (Math.abs(tmpFTXPrice2 - ftxPrice2) >= updateNum) {
					try {
						ftxPrice2 = tmpFTXPrice2
						tx = await client.editOrder(orderID2, symbol, 'limit', 'sell', remaining2, ftxPrice2)
						orderID2 = tx['id']
					} catch (e) {}
				}
			}

			if (flag2) {
				while (true) {
					try {
						await clearingHouse.openPosition(
							PositionDirection.LONG,
							new BN(driftPrice * amount * QUOTE_PRECISION),
							MarketInfo.marketIndex
						)
						errCount = 0
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

				if (stopCount === 10) {
					console.log('stop')
					process.exit(0)
				}
				
				
				console.log('driftでの約定確認')
				console.log(`Count: ${count}, Position Amount: ${amount * count} ${baseAsset}`)
				count -= 1
				flag2 = false
				flagOrder2 = true
				errCount = 0

				if (count === 0) {
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

					while (true) {
						try {
							let positions = await client.fetchPositions()

							for (let position of positions) {
								if (position['symbol'] === symbol){
						
									if (Number(position['info']['size']) !== 0) {
										let closeAmount = position['info']['size']
										let closeSide: ('buy' | 'sell') = position.side === 'long' ? 'sell' : 'buy'

										await client.createMarketOrder(symbol, closeSide, closeAmount)
									}
								}
							}

							break
						} catch (e) {}
					}
				}
			}
		}

		// await sleep(100)
	}
}


const check = async (base: number, delta: number) => {
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHousePublicKey
	)
	await clearingHouse.subscribe()
	const pythClient = new PythClient(connection)
	
	while (true) {
		while (true) {
			try {
				let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
				let FundingRateDrift = convertToNumber(
					await calculateEstimatedFundingRate(MarketAccount, await pythClient.getPriceData(MarketAccount.amm.oracle), new BN(1), "interpolated")
				)
		
				let info = await client.fetchFundingRate(symbol)
				let FundingRateFTX = 100 * info.nextFundingRate
				
				let num = FundingRateFTX - FundingRateDrift

				if (num <= -0.01) {
					kairi1 = base + delta * 4
					kairi2 = base - delta * 2
				} else if (-0.01 < num && num < -0.005) {
					kairi1 = base + delta * 2
					kairi2 = base - delta
				} else if (-0.005 <= num && num <= 0.005) {
					kairi1 = base
					kairi2 = base
				} else if (0.005 < num && num < 0.01) {
					kairi1 = base - delta
					kairi2 = base + delta * 2
				} else {
					kairi1 = base - delta * 2
					kairi2 = base + delta * 4
				}

				break
			} catch(e) {}
		}

		await sleep(600000)
	}
}


// ---------------------------------------------------------------------------


main()
check(0.27, 4)
