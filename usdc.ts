require('dotenv').config()
import axios from 'axios'
import { ftx } from "ccxt"
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { Wallet, ClearingHouse, ClearingHouseUser, initialize, convertToNumber, QUOTE_PRECISION } from '@drift-labs/sdk'
import { sleep } from './libs/lib'


const URL = process.env.DiscordWebhook

const clientMain = new ftx({
    apiKey: process.env.apiKeyMain,
	secret: process.env.secretMain
})

const connection = new Connection(process.env.RPCendpoint)
const keypairMain = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(process.env.secretKeyMain))
)
const keypairSub = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.secretKeySub))
)
const walletMain = new Wallet(keypairMain)
const walletSub = new Wallet(keypairSub)

const sdkConfig = initialize({ env: 'mainnet-beta' })
const clearingHousePublicKey = new PublicKey(
	sdkConfig.CLEARING_HOUSE_PROGRAM_ID
);


// ---------------------------------------------------------------------------


(async () => {
	const clearingHouseMain = ClearingHouse.from(
		connection,
		walletMain,
		clearingHousePublicKey
	)
	await clearingHouseMain.subscribe()

	const userMain = ClearingHouseUser.from(clearingHouseMain, walletMain.publicKey)
	await userMain.subscribe()

    const clearingHouseSub = ClearingHouse.from(
        connection,
        walletSub,
        clearingHousePublicKey
    )
    await clearingHouseSub.subscribe()

	const userSub = ClearingHouseUser.from(clearingHouseSub, walletSub.publicKey)
	await userSub.subscribe()


	while (true) {
		while (true) {
			try {
				let USDC = 0

				let balance = await clientMain.fetchBalance()
				USDC += balance['USD']['total']

				let infoMain = userMain.getTotalCollateral()
				let collateralMain = convertToNumber(infoMain, QUOTE_PRECISION)
				USDC += collateralMain

				let infoSub = userSub.getTotalCollateral()
				let collateralSub = convertToNumber(infoSub, QUOTE_PRECISION)
				USDC += collateralSub

				let postData = {
					username: '残高通知bot',
					content: String(USDC)
				}

				await axios.post(URL, postData)
				break
			} catch (e) {}
		}

		await sleep(450000)
	}
})()