const express = require("express");
const dotenv = require('dotenv');
const { nanoid } = require("nanoid");
const Database  = require('better-sqlite3');
const dns = require('dns');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');


dotenv.config(); // loads env variables from .env (Needn't hardcode sensitive info(ports, paths))

const app = express();
app.use(helmet()); // Protects from common web vulnerabilities by setting appropriate headers

const dnsLookupPromise = promisify(dns.lookup);


//Rate limiter
const limiter = rateLimit({
    windowMs: 15*60*1000, // 15 min
    max: 100, // Limit to 100 req per window for 1 ip
    standardHeaders: true,
    legacyHeaders: false,
    message: {error: "Too many requests, please try again later :("},
});

app.use('/api/',limiter);

//Logging

// To check log directory is present
const logsDir = path.join(process.cwd(), "logs");
if(!fs.existsSync(logsDir)){
    fs.mkdirSync(logsDir);
}

// Access the logs

const accessLogStream = fs.createWriteStream(path.join(logsDir, "access.log"), {flags: "a"});
app.use(morgan("combined", {stream:accessLogStream})); // Detailed logs written to the file
app.use(morgan("dev")); // Simplifies logs for console output during development

// DB init
let db;
try{
    const dataDir = path.join(process.cwd(),"data"); // Create an OS independent path /data in the current project folder
    if(!fs.existsSync(dataDir)){
        fs.mkdirSync(dataDir);
    }

    db = new Database(path.join(process.cwd(),"data","urlDatabase.db"), { //data/urlDatabase.db
        verbose: process.env.NODE_ENV === "development" ? console.log:null,
    }); // dev mode - logs all SQL queries , production mode - silent (good practices)

    db.pragma("journal_mode = WAL"); 
    //pragma - only in sqlite for configuring commands to control the db behaviour internally (Settings panel for sqlite)
    // WAL - Write ahead logging (Write changes to a separate WAL file, reads continue from main db & later merge the changes)(better concurrency)
    // After write in WAL file, it is commited. Then if we need to access the data immediately it searches in main db+ WAL file and returns the result based on the recently updated timestamp.
    // Snapshot isolation - if read starts before write commit - it'll not see the data and vice versa
    // WAL improves concurrency and commited writes are immediately visible to subsequent reads
    // db.prepare(...).run() - ensures the flow - BEGIN->EXECUTE->COMMIT. So in this case the data will be commited hence the read operation can handle it
    // Else it'll just hide the run command and return null there (temporarily this means write hasn't been commited yet)
    //Improves write performance and reliability. Without this sqlite locks entire DB on writes(i.e., until the data is wriiten we can't even perform read operation)
    
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

    // Index - Makes lookups faster. Without index searches whole table, with index - O(log n)
    // We don't use UNIQUE in original_url because same URL may come from independent sources, if two original urls are the same but from diff websites we need to create a separate short url for both so that we can correctly point to the original url as well as count the number of hits the website had

} catch(err){
    console.error("Database init error!", err.message);
    process.exit(1);
}

// Middleware config
app.use("/public", express.static(path.join(process.cwd(),"public"))); // Serves static files(HTML,CSS,JS,img) (Avoid writing routes for each file) (Very fast)
app.use(express.urlencoded({extended: false})); //HTML forms parsing
// Without this we can't access the body of the incoming request. The middleware parses it to extract the body of the request(false - simple parsing)(true - supports nested(e.g., {user:{name:"rag"}} may not be parsed properly if false))
app.use(express.json()); // APIs / JSON parsing (ensures the req.body is usable else without this we can't get proper result)

//URL Validation
async function isValidUrl(urlString) {
    try{
        const url = new URL(urlString);
        if(url.protocol !== "http:" && url.protocol !== "https:") return false;

        await dnsLookupPromise(url.hostname); // Validates hostnames existence
        return true;
    } catch {
        return false;
    }
}

//DB operations
const dbOperations = {
    //db.prepare() - compiles SQL to reusable st, prevents SQL injection, improves performance
    // methods - .get()(one row),.all()(Multiple rows),.run()(Insert/update/delete) 
    // prepare + ?(placeholder) - safe & fast
    // Good - db.prepare("SELECT * FROM urls WHERE short_url = ?");
    // Bad - db.exec(`SELECT * FROM urls WHERE short_url = ${shortUrl}`)
    getLongURL: (shortURL) => {
        const stmt = db.prepare(`
                UPDATE urls SET hits = hits+1 WHERE short_url = ? RETURNING original_url
            `); //hits = hits+1 is safe as write is serialized here and hits++ is not safe as it is not serialized(CLASSIC BUG)
            const result = stmt.get(shortURL);
            return result ? result.original_url:null; // If short_url doesn't exist returns null
    },
    
    // Use this kind of approach in high-traffic apps for better performance
    createShortUrl: (shortURL, originalUrl) =>{
        const stmt = db.prepare("INSERT INTO urls (short_url,original_url) VALUES (?,?)");
        return stmt.run(shortURL,originalUrl); /// if doesn't exist then have to handle the req
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

//Routes
//home
app.get("/",(req,res)=>{
    res.sendFile(path.join(process.cwd(), "views","index.html"));
});
// create short url
app.post("/api/shorturl", async (req,res,next) =>{
    try{
        const origUrl = req.body.url;
        if(!origUrl) return res.status(400).json({error: "URL is requried"});
        if(!(await isValidUrl(origUrl))){
            return res.status(400).json({error: "Invalid URL", original_url:origUrl});
        }

        let shortUrl, attempts = 0, maxAttempts = 5;
        while(attempts < maxAttempts){
            shortUrl = nanoid(6);
            try{
                dbOperations.createShortUrl(shortUrl, origUrl);
                break;
            } catch(error){
                if(error.code === "SQLITE_CONSTRAINT") attempts++;
                else throw error;
            }
        }

        res.status(201).json({
            original_url:origUrl,
            short_url: shortUrl,
            short_url_full: `${req.protocol}://${req.get("host")}/api/shortUrl/${shortUrl}`,
        });
    } catch(error){
        next(error);
    }
});

// Redirect to original url
app.get("/api/shorturl/:value", async (req,res,next) =>{
    try{
        const longURL = dbOperations.getLongURL(req.params.value);
        if(!longURL) return res.status(404).json({error: "Short URL not found"});
        res.redirect(longURL);
    } catch(error){
        next (error);
    }
});

//get url statistics
app.get("/api/stats/:shortUrl", async(req,res,next) =>{
    try{
        const stats = dbOperations.getUrlStats(req.params.shortUrl);
        if(!stats) return res.status(404).json({error: "URL not found"});
        res.json({
            original_url: stats.original_url,
            short_url: stats.short_url,
            created_at: stats.created_at,
            hits: stats.hits,
        });
    } catch(error){
        next(error);
    }
});

//Admin endpoint(unprotected)
app.get("/api/admin/urls", async(req,res,next) =>{
    try{
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const urls = dbOperations.getAllUrls(limit,offset);
        res.json({urls});
    } catch (error) {
        next(error);
    }
});

//Error handling middleware
app.use((err,req,res,next) =>{
    console.error(err.stack);
    res.status(500).json ({
        error: "Something went wrong!",
        message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
});

//Health check endpoint (Uptime monitoring)
app.get('/health',(req,res) =>{
    res.status(200).json({status:"ok"});
});

// Proper shutdown

process.on("SIGINT", ()=>{
    console.log("Closing database connection...");
    db.close();
    process.exit(0);
});

process.on("SIGTERM", () =>{
    console.log("Closing database connection...");
    db.close();
    process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>{
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
