// Helper functions
export const percent = (percent, num) => {
    return (num / 100) * percent;
}

export const roundDown = (number, decimals) => {
    decimals = decimals || 0;
    return ( Math.floor( number * Math.pow(10, decimals) ) / Math.pow(10, decimals) );
}

export const minusPercent = (p, n) => {
    const pInt = parseFloat(n)
    return pInt - (pInt * (p/100));
}

export const plusPercent = (p, n) => {
    const pInt = parseFloat(n)
    return pInt + (pInt * (p/100));
}

export const timePassed = (start) => { //1729826486254
    // get the end time 
    let end = Date.now(); 
    // elapsed time in milliseconds 
    let elapsed = end - start;    
    // converting milliseconds to seconds  
    // by dividing 1000 
    return (elapsed/1000); 
}

export const calculateProfit = (currentPrice, orderPrice) => {
    let profit = ((currentPrice/orderPrice) - 1) * 100;
    return profit;
}

export const getLastElement = (array) => {
    return array.slice(-1)[0];//array[array.length -1]; but non destructive
}

export const wait = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// You can also export as a default object if you prefer:
// export default { percent, roundDown, minusPercent, plusPercent, timePassed, calculateProfit, getLastElement, wait };