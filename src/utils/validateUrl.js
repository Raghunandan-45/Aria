const dns = require('dns');
const {promisfy} = require("util");

const dnsLookupPromise = promisfy(dns.lookup);

async function isValidUrl(urlString) {
    try{
        const url = new URL(urlString);
        if(url.protocol !== "http:" && url.protocol !== "https:") return false;

        await dnsLookupPromise(url.hostname); 
        return true;
    } catch {
        return false;
    }
}

module.exports = isValidUrl;