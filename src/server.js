const express = require("express");

const dotenv = require('dotenv');
dotenv.config(); 

const { nanoid } = require("nanoid");

const db = require("./database/db");
const urlRepository = require("./database/urlRepository");
const isValidUrl = require("./utils/validateUrl");

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');



const app = express();
app.use(helmet()); // Protects from common web vulnerabilities by setting appropriate headers



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

//To check log directory is present
const logsDir = path.join(process.cwd(), "logs");
if(!fs.existsSync(logsDir)){
    fs.mkdirSync(logsDir);
}

//Access the logs

const accessLogStream = fs.createWriteStream(path.join(logsDir, "access.log"), {flags: "a"});
app.use(morgan("combined", {stream:accessLogStream})); // Detailed logs written to the file
app.use(morgan("dev")); // Simplifies logs for console output during development

//DB init


// Middleware config
app.use("/public", express.static(path.join(process.cwd(),"public"))); // Serves static files(HTML,CSS,JS,img) (Avoid writing routes for each file) (Very fast)
app.use(express.urlencoded({extended: false})); //HTML forms parsing
// Without this we can't access the body of the incoming request. The middleware parses it to extract the body of the request(false - simple parsing)(true - supports nested(e.g., {user:{name:"rag"}} may not be parsed properly if false))
app.use(express.json()); // APIs / JSON parsing (ensures the req.body is usable else without this we can't get proper result)

//URL Validation


//DB operations


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
                urlRepository.createShortUrl(shortUrl, origUrl);
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
        const longURL = urlRepository.getLongURL(req.params.value);
        if(!longURL) return res.status(404).json({error: "Short URL not found"});
        res.redirect(longURL);
    } catch(error){
        next (error);
    }
});

//get url statistics
app.get("/api/stats/:shortUrl", async(req,res,next) =>{
    try{
        const stats = urlRepository.getUrlStats(req.params.shortUrl);
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
        const urls = urlRepository.getAllUrls(limit,offset);
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
