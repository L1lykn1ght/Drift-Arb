export const sleep = async (ms: number) => {
    return new Promise(r => setTimeout(r, ms))
}

export const updateNumber = {
    ftx: {
        LUNA: 0.005,
        AVAX: 0.005,
        MATIC: 0.00001,
        ATOM: 0.001,
        DOT: 0.002
    }
}
