require('dotenv').config()
import {
    Wallet,
    ClearingHouse,
    initialize, Markets,
    convertToNumber,
    convertBaseAssetAmountToNumber,
    QUOTE_PRECISION
} from "@drift-labs/sdk"
import { Connection, Keypair, PublicKey } from "@solana/web3.js"


const connection = new Connection(process.env.RPCendpoint, 'processed')
const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.secretKeyMain))
)
const wallet = new Wallet(keypair)
const sdkConfig = initialize({env: 'mainnet-beta'})
const clearingHousePublicKey = new PublicKey(sdkConfig.CLEARING_HOUSE_PROGRAM_ID)


const main = async () => {
    const clearingHouse = ClearingHouse.from(
        connection,
        wallet,
        clearingHousePublicKey
    )
    await clearingHouse.subscribe()

    const tokenList = ['LUNA', 'ATOM', 'ADA', 'MATIC']

    for (let token of tokenList) {
        const market = Markets.find((market) => market.baseAssetSymbol === token)
        const marketAccount = clearingHouse.getMarket(market.marketIndex)

        console.log(market.baseAssetSymbol)
        console.log(`LONG : ${convertBaseAssetAmountToNumber(marketAccount.baseAssetAmountLong)}`)
        console.log(`SHORT: ${convertBaseAssetAmountToNumber(marketAccount.baseAssetAmountShort)}`)
        // console.log(`SUM  : ${convertBaseAssetAmountToNumber(marketAccount.baseAssetAmount)}`)
        console.log(`POOL : ${
            convertToNumber(marketAccount.amm.totalFeeMinusDistributions, QUOTE_PRECISION)
             - convertToNumber(marketAccount.amm.totalFee, QUOTE_PRECISION) / 2}`
        )
    }

    await clearingHouse.unsubscribe()
}


main()
