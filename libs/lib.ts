export const sleep = async (ms: number) => {
    return new Promise(r => setTimeout(r, ms))
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
