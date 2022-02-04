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
    'ALGO'
]

export const updateNumber = {
    ftx: {
        LUNA: 0.005,
        AVAX: 0.005,
        MATIC: 0.00001,
        ATOM: 0.001,
        DOT: 0.002,
        ADA: 0.000005
    }
}
