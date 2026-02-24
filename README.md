# Maik - CLI Email Client

A command-line tool to download and index emails from an IMAP server.

## Installation

```bash
npm install -g maik
```

## Configuration

Create a configuration file at `~/.config/maik/config.txt`:

> **Gmail users:** To get an app password, visit [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). You need to have 2-Step Verification enabled. Use the generated app password instead of your regular Gmail password.

```
# IMAP server settings
host = imap.example.com
user = your-email@example.com
password = your-password

# Output directory for downloaded emails
output = ~/mail
```

## Usage

### Download emails

```bash
# it might take a long time and a lot of space locally
maik fetch

```

### Index emails

After downloading emails, create a SQLite index for fast searching:

```bash
maik index
```

The index is stored in `~/<output>/index.sqlite` with the following schema:

```sql
CREATE TABLE emails (
  uid INTEGER PRIMARY KEY,
  date INTEGER,          -- Unix timestamp
  sender TEXT,           -- Sender email address
  sender_name TEXT,      -- Sender display name
  "to" TEXT,             -- Recipients
  subject TEXT,
  size INTEGER,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,             -- References header
  cc TEXT,
  bcc TEXT,
  reply_to TEXT,
  delivered_to TEXT,
  attachments TEXT,      -- Attachments (filename:mimeType)
  received_spf TEXT
);

```

To query dates in human-readable format, use SQLite's datetime function:
```sql
SELECT uid, datetime(date, 'unixepoch') as date, sender, subject FROM emails;
```

## Email Storage

Emails are stored in the format:
```
output_dir/
  YYYY-MM/          # Year-Month folder
    <uid>/          # Per-email folder
      source.eml    # Raw email file
```


## crontab

To download and index emails automatically, add the following to your crontab (`crontab -e`).
Replace `your_username` with your actual macOS username and adjust the Node.js version path to match your environment (`node --version` to check):

```crontab
HOME=/Users/your_username
PATH=/Users/your_username/.nvm/versions/node/v22.20.0/bin:/usr/local/bin:/usr/bin:/bin

# Fetch new emails and rebuild the index every 5 minutes, logging output to ~/crontab.log
*/5 * * * * maik fetch && maik index >> $HOME/crontab.log 2>&1
```

## Tune

Add `maik` as a middleware in your [Tune](https://github.com/iovdin/tune) setup.

Edit `~/.tune/default.ctx.js` and add `require("maik/middleware")` to your middleware array:

```js
const maik = require("maik/middleware")

module.exports = [
  // ... your other middleware ...
  maik,
  // ...
]
```

The middleware allows Tune to read email bodies and attachments as files:

mail/YYYY-MM/<uid>/body.txt
mail/YYYY-MM/<uid>/body.html
mail/YYYY-MM/<uid>/<attachmentname.ext>


### Usage

Use `mail.prompt` as a system prompt in your Tune chat. It automatically:
- Loads the `rf` (read file) and `mistral_ocr` tools
- Connects a `mail_query` tool wired to your `~/mail/index.sqlite` database
- Injects the live email table schema
- Reminds the model to always use `datetime(date, 'unixepoch')` for dates and to `LIMIT` queries

```
@rf
@mistral_ocr

@{ sqlite | curry filename=~/mail/index.sqlite $name=mail_query }
You are mail assistant.

<emails-table-schema>
@{| proc sqlite filename=~/mail/index.sqlite text="PRAGMA table_info(emails);" }
</emails-table-schema>

You can read text of email from file
mail/YYYY-MM/<uid>/body.txt
or 
mail/YYYY-MM/<uid>/body.html

attachment are accessable by path
mail/YYYY-MM/<uid>/<attachmentname.ext>


Always transform date to datetime(date, 'unixepoch')
...
```

here is a chat example

```chat
system: @@mail.prompt
user:
find emails from HomeNest (company I rent apartment from)

assistant:

tool_call: mail_query {"format":"table"}
SELECT uid, datetime(date, 'unixepoch') as dt, sender, sender_name, subject 
FROM emails 
WHERE sender LIKE '%homenest%' 
   OR sender_name LIKE '%homenest%' 
   OR subject LIKE '%homenest%' 
ORDER BY date DESC LIMIT 5;

tool_result:
+--------+---------------------+---------------------------+-------------+--------------------------------------------+
|  uid   |         dt          |          sender           | sender_name |                 subject                    |
+--------+---------------------+---------------------------+-------------+--------------------------------------------+
| 285411 | 2026-05-18 14:22:10 | billing@homenestliving.com|             | Invoice period 1-6-2026 to 30-6-2026      |
| 284992 | 2026-04-19 09:15:44 | billing@homenestliving.com|             | Invoice period 1-5-2026 to 31-5-2026      |
| 284501 | 2026-04-05 11:02:18 | support@homenestliving.com|             | Maintenance notice                         |
| 283876 | 2026-03-17 15:44:02 | billing@homenestliving.com|             | Invoice period 1-4-2026 to 30-4-2026      |
| 282940 | 2026-02-12 10:28:33 | billing@homenestliving.com|             | Invoice period 1-3-2026 to 31-3-2026      |
+--------+---------------------+---------------------------+-------------+--------------------------------------------+

assistant:
Here are the latest emails from **HomeNest Living (billing@homenestliving.com)**:

1. 2026-05-18 — Invoice period 1-6-2026 to 30-6-2026 (uid 285411)  
2. 2026-04-19 — Invoice period 1-5-2026 to 31-5-2026 (uid 284992)  
3. 2026-04-05 — Maintenance notice (uid 284501)  
4. 2026-03-17 — Invoice period 1-4-2026 to 30-4-2026 (uid 283876)  
5. 2026-02-12 — Invoice period 1-3-2026 to 31-3-2026 (uid 282940)  

Would you like me to:
- Open one of these?
- Download the latest invoice attachment?
- Show all emails from HomeNest?
- Summarize billing history?

user:
can you read the latest one and parse the invoice

assistant:

tool_call: mail_query {"format":"table"}
SELECT uid, datetime(date, 'unixepoch') as dt, subject, attachments 
FROM emails 
WHERE uid = 285411 LIMIT 1;

tool_result:
+--------+---------------------+------------------------------------------+-------------------------------------------------------------------+
|  uid   |         dt          |                 subject                  |                             attachments                            |
+--------+---------------------+------------------------------------------+-------------------------------------------------------------------+
| 285411 | 2026-05-18 14:22:10 | Invoice period 1-6-2026 to 30-6-2026     | INV-2026-06-4587.pdf:application/pdf, INV-2026-06-4587.xml:application/xml |
+--------+---------------------+------------------------------------------+-------------------------------------------------------------------+

assistant:

tool_call: mistral_ocr {"filename":"mail/2026-05/285411/INV-2026-06-4587.pdf"}

tool_result:

HomeNest Living  
<cut>  
<cut>  
Email: billing@homenestliving.com  
Website: www.homenestliving.com  

John Carter  
<cut>  
<cut>  
United Kingdom  

INVOICE  

Property: Riverside Apartments, London  
Invoice date: 18-05-2026  
Subject: Invoice period 1-6-2026 to 30-6-2026  
Due date: 05-06-2026  
Invoice number: INV-2026-06-4587  
Customer number: CUST-90421  

The following amount is due:

| Description      | Net (£) | VAT (%) | VAT (£) | Total (£) |
|------------------|---------|---------|---------|-----------|
| Rent             | 1,250.00| 0%      | 0.00    | 1,250.00  |
| Service charges  | 150.00  | 0%      | 0.00    | 150.00    |
| TOTAL            | 1,400.00|         | 0.00    | 1,400.00  |

Please transfer the amount before the due date, referencing the invoice and customer number.

IBAN: GB29NWBK60161331926819  
Account name: Urban Living Group Ltd  
BIC: NWBKGB2L  
VAT number: GB123456789  
Company number: 09876543
```
