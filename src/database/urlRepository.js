const db = require("./db");

const urlRepository = {
    getLongURL: (shortURL) => {
        const stmt = db.prepare(`
                UPDATE urls SET hits = hits+1 WHERE short_url = ? RETURNING original_url
            `); 
            const result = stmt.get(shortURL);
            return result ? result.original_url:null;
    },
    
    createShortUrl: (shortURL, originalUrl) =>{
        const stmt = db.prepare("INSERT INTO urls (short_url,original_url) VALUES (?,?)");
        return stmt.run(shortURL,originalUrl); 
    },
    
    getUrlStats: (shortURL) => {
        const stmt = db.prepare("SELECT * FROM urls where short_url=?");
        return stmt.get(shortURL);
    },

    getAllUrls: (limit = 100, offset = 0) => {
        const stmt = db.prepare("SELECT * FROM urls ORDER BY created_at DESC LIMIT ? OFFSET ?");
        return stmt.all(limit,offset);
    }
};

module.exports = urlRepository;