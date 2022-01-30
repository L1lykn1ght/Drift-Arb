require('dotenv').config()
import { ftx } from 'ccxt'
import { BN, Wallet } from '@project-serum/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
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
import { sleep } from './libs/lib'

const QUOTE_PRECISION = 10 ** 6


// ---------------------------------------------------------------------------


const connection = new Connection(process.env.RPCendpoint, 'processed')
const keypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(process.env.secretKeyMain))
)
const wallet = new Wallet(keypair)
const sdkConfig = initialize({ env: 'mainnet-beta' })
const clearingHousePublicKey = new PublicKey(sdkConfig.CLEARING_HOUSE_PROGRAM_ID)
const client = new ftx ({
	apiKey: process.env.apiKeyMain,
	secret: process.env.secretMain
})


// ---------------------------------------------------------------------------


const baseAsset = 'LUNA'
const symbol = baseAsset + '-PERP'
const amount = 5
const limit = 60
let count = 48
// LUNA: 0.005, AVAX: 0.005, MATIC: 0.00001, ATOM: 0.001, DOT: 0.002
const updateNum = 0.005
let kairi1 = 0.27
let kairi2 = 0.27
let flag1 = false
let flag2 = false
let flagOrder1 = true
let flagOrder2 = true
let errCount = 0
let stopCount = 0
const MarketInfo = Markets.find((market) => market.baseAssetSymbol === baseAsset)


// ---------------------------------------------------------------------------


const main = async () => {
	const clearingHouse = ClearingHouse.from(
		connection,
		wallet,
		clearingHousePublicKey
	)
	await clearingHouse.subscribe()

	let MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
	let currentMarketPrice = calculateMarkPrice(MarketAccount)
	let driftPrice = convertToNumber(currentMarketPrice, MARK_PRICE_PRECISION)
	let tx = undefined


	while (true) {
		MarketAccount = clearingHouse.getMarket(MarketInfo.marketIndex)
		currentMarketPrice = calculateMarkPrice(MarketAccount)
		let tmpdriftPrice = convertToNumber(currentMarketPrice, MARK_PRICE_PRECISION)

		if (count < limit) {
			if (flagOrder1) {
				var ftxPrice1 = driftPrice * (100 - kairi1) / 100
				while (true) {
					try {
						tx = await client.createLimitBuyOrder(symbol, amount, ftxPrice1)
						var orderID1 = tx['id']
						break
					} catch (e) {
						console.log(e.message)
					}
				}
				flagOrder1 = false
			}

			while (true) {
				try {
					tx = await client.fetchOrder(orderID1, symbol)
					var status1 = tx['status']
					var remaining1 = tx['remaining']
					break
				} catch (e) {}
			}

			if (status1 === 'closed') {
				console.log('ftxでの約定確認')
				flag1 = true
			
			} else if (status1 === 'canceled') {
				flagOrder1 = true

			} else if (tmpdriftPrice !== driftPrice) {
				driftPrice = tmpdriftPrice
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
							console.log(info)

							if (info.value) {
								errCount = 0
								break
							} else {
								errCount += 1
							}
						}

						if (errCount === 2) {
							errCount = 0
							stopCount += 1
							console.log('pass')
							break
						}
					}
				}

				if (stopCount == 10) {
					console.log('緊急停止')
					process.exit(0)
				}
				
				count += 1
				console.log('driftでの約定確認')
				console.log(`推定ポジション量, FTXlong: ${amount * count} ${baseAsset}, Driftshort: ${amount * count} ${baseAsset}`)
				flag1 = false
				flagOrder1 = true

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
							var positions = await client.fetchPositions()
							break
						} catch (e) {}
					}

					for (let position of positions) {
						if (position['symbol'] === symbol){
				
							if (Number(position['info']['size']) !== 0) {
								let closeAmount = position['info']['size']
								let closeSide = undefined
				
								if (position['side'] === 'long') {
									closeSide = 'sell'
								} else {
									closeSide = 'buy'
								}

								while (true) {
									try {
										await client.createMarketOrder(symbol, closeSide, closeAmount)
										break
									} catch (e) {
										console.log(e.message)
									}
								}
							}
						}
					}
				}
			}
		}

		if (-limit < count) {
			if (flagOrder2) {
				var ftxPrice2 = driftPrice * (100 + kairi2) / 100
				while (true) {
					try {
						tx = await client.createLimitSellOrder(symbol, amount, ftxPrice2)
						var orderID2 = tx['id']
						break
					} catch (e) {
						console.log(e.message)
					}
				}
				flagOrder2 = false
			}

			while (true) {
				try {
					tx = await client.fetchOrder(orderID2, symbol)
					var status2 = tx['status']
					var remaining2 = tx['remaining']
					break
				} catch (e) {}
			}
			
			if (status2 === 'closed') {
				console.log('ftxでの約定確認')
				flag2 = true
			
			} else if (status2 === 'canceled') {
				flagOrder2 = true
			
			} else {
				driftPrice = tmpdriftPrice
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
							console.log(info)

							if (info.value) {
								errCount = 0
								break
							} else {
								errCount += 1
							}
						}

						if (errCount === 2) {
							errCount = 0
							stopCount += 1
							console.log('pass')
							break
						}
					}
				}

				if (stopCount == 10) {
					console.log('緊急停止')
					process.exit(0)
				}
				
				count -= 1
				console.log('driftでの約定確認')
				console.log(`推定ポジション量, FTXlong: ${amount * count} ${baseAsset}, Driftshort: ${amount * count} ${baseAsset}`)
				flag2 = false
				flagOrder2 = true

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
							var positions = await client.fetchPositions()
							break
						} catch (e) {}
					}

					for (let position of positions) {
						if (position['symbol'] === symbol){
				
							if (Number(position['info']['size']) !== 0) {
								let closeAmount = position['info']['size']
								let closeSide = undefined
				
								if (position['side'] === 'long') {
									closeSide = 'sell'
								} else {
									closeSide = 'buy'
								}

								while (true) {
									try {
										await client.createMarketOrder(symbol, closeSide, closeAmount)
										break
									} catch (e) {
										console.log(e.message)
									}
								}
							}
						}
					}
				}
			}
		}

		await sleep(100)
	}
}


const check = async () => {
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
					kairi1 = 0.4
					kairi2 = 0.2
				} else if (-0.01 < num && num < -0.005) {
					kairi1 = 0.335
					kairi2 = 0.235
				} else if (-0.005 <= num && num <= 0.005) {
					kairi1 = 0.27
					kairi2 = 0.27
				} else if (0.005 < num && num < 0.01) {
					kairi1 = 0.235
					kairi2 = 0.335
				} else {
					kairi1 = 0.2
					kairi2 = 0.4
				}

				break
			} catch(e) {
				console.log(e)
			}
		}

		await sleep(600000)
	}
}


// ---------------------------------------------------------------------------


main()
check()
