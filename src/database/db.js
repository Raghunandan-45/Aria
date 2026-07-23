const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

let db;
try{
    const dataDir = path.join(process.cwd(),"data"); 
    if(!fs.existsSync(dataDir)){
        fs.mkdirSync(dataDir);
    }

    db = new Database(path.join(process.cwd(),"data","urlDatabase.db"), { 
        verbose: process.env.NODE_ENV === "development" ? console.log:null,
    }); 

    db.pragma("journal_mode = WAL"); 
    
    db.exec(`
            CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_url TEXT UNIQUE NOT NULL,
            original_url TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            hits INTEGER DEFAULT 0 
            );
            CREATE INDEX IF NOT EXISTS idx_short_url ON urls(short_url);
        `);

} catch(err){
    console.error("Database init error!", err.message);
    process.exit(1);
}


module.exports = db;