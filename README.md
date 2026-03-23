i# URL Shortener Backend

## Overview

This project is a URL shortener backend built using Node.js, Express, and SQLite. It allows users to generate short URLs, redirect to original URLs, and track usage statistics.

The system is designed with production-oriented practices including logging, rate limiting, database indexing, and concurrency handling using SQLite WAL mode.

---

## Features

- Create short URLs from long URLs
- Redirect short URLs to original URLs
- Track number of hits per URL
- Retrieve statistics for each short URL
- Pagination support for listing URLs
- Rate limiting for API protection
- Logging to file and console
- Security headers using Helmet
- Graceful shutdown handling

---

## Tech Stack

- Node.js
- Express.js
- SQLite (better-sqlite3)
- nanoid (for short URL generation)
- Helmet (security)
- express-rate-limit (API protection)
- Morgan (logging)

---

## Project Structure

```
project/
│
├── data/               # SQLite database (auto-created)
├── logs/               # Log files (auto-created)
├── views/
│   └── index.html      # Optional homepage
├── public/             # Static files (optional)
├── server.js           # Main server file
├── .env                # Environment variables
└── package.json
```

---

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install express dotenv nanoid better-sqlite3 helmet express-rate-limit morgan
```

---

## Running the Server

```bash
node server.js
```

Server runs on:

```
http://localhost:3000
```

---

## API Endpoints

### 1. Health Check

**GET** `/health`

Response:

```json
{
  "status": "ok"
}
```

---

### 2. Create Short URL

**POST** `/api/shorturl`

Request Body:

```json
{
  "url": "https://example.com"
}
```

Response:

```json
{
  "original_url": "https://example.com",
  "short_url": "abc123",
  "short_url_full": "http://localhost:3000/api/shorturl/abc123"
}
```

---

### 3. Redirect to Original URL

**GET** `/api/shorturl/:value`

**Behavior:**

- Redirects to the original URL
- Increments hit count

---

### 4. Get URL Statistics

**GET** `/api/stats/:shortUrl`

Response:

```json
{
  "original_url": "https://example.com",
  "short_url": "abc123",
  "created_at": "timestamp",
  "hits": 10
}
```

---

### 5. Admin — List URLs

**GET** `/api/admin/urls?page=1&limit=20`

Response:

```json
{
  "urls": [ ... ]
}
```

---

## Database Design

**Table:** `urls`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer | Primary Key |
| `short_url` | Text | Unique |
| `original_url` | Text | |
| `created_at` | Timestamp | |
| `hits` | Integer | |

**Indexes:** Index on `short_url` for faster lookup

---

## Key Design Decisions

### 1. WAL Mode

SQLite is configured with Write-Ahead Logging to allow concurrent reads and writes and improve performance.

### 2. Atomic Hit Counting

Hit count is updated using:

```sql
UPDATE urls SET hits = hits + 1 WHERE short_url = ?
```

This avoids race conditions.

### 3. Prepared Statements

All queries use prepared statements to:

- Prevent SQL injection
- Improve performance

### 4. Non-Unique `original_url`

Multiple short URLs can map to the same original URL to support tracking and flexibility.

---

## Middleware Used

| Middleware | Purpose |
|---|---|
| Helmet | Adds security headers |
| Rate Limiter | Prevents abuse |
| Morgan | Logs requests to file and console |
| express.json | Parses JSON request bodies |
| express.urlencoded | Parses form data |
| express.static | Serves static files |

---

## Logging

- Logs stored in `logs/access.log`
- Console logs enabled for development

---

## Error Handling

Centralized error handling middleware returns:

```json
{
  "error": "Something went wrong"
}
```

---

## Shutdown Handling

Gracefully closes the database connection on:

- `SIGINT`
- `SIGTERM`

---

## Testing

**Recommended tools:** Postman, Thunder Client

**Test flow:**

1. Health check
2. Create short URL
3. Redirect using generated URL
4. Fetch stats

---

## Future Improvements

- Custom aliases for short URLs
- Expiration for URLs
- Authentication for admin routes
- Frontend UI
- Automated testing (Jest + Supertest)
- Deployment (Render, Railway, VPS)

---

## Conclusion

This project demonstrates a production-oriented backend system with proper handling of database operations, concurrency, and API design. It serves as a strong foundation for scalable backend development.
