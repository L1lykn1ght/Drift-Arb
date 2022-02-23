import { question, keyInSelect, keyInYN } from 'readline-sync'


export const sleep = async (ms: number) => {
    return new Promise(r => setTimeout(r, ms))
}


export const input = (): [string, number, number] => {
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

    return [baseAsset, amount, limit]
}


export const baseAssets = [
    'SOL',
    'BTC',
    'ETH',
    'LUNA',
    'AVAX',
    'BNB',
    'MATIC',
    'ATOM',
    'DOT',
    'ADA',
    'ALGO',
    'FTT'
]


export const updateNumber = {
    ftx: {
        SOL: 0.005,
        BTC: 5,
        ETH: 0.5,
        LUNA: 0.005,
        AVAX: 0.005,
        BNB: 0.02,
        MATIC: 0.00001,
        ATOM: 0.001,
        DOT: 0.002,
        ADA: 0.000005,
        ALGO: 0.0002,
        FTT: 0.002
    }
}


export interface ftxLimitOrder {
    status: 'open' | 'closed' | 'canceled',
    orderId: string,
    price: number,
    remaining: number
}


export type Side = 'buy' | 'sell'


export const QUOTE_PRECISION = 10 ** 6
