# Maik - CLI Email Client

A command-line tool to download and index emails from an IMAP server.

## Installation

```bash
bun install
```

## Configuration

Create a configuration file at `~/.config/maik/config.txt`:

```
# IMAP server settings
host = imap.example.com
user = your-email@example.com
password = your-password

# Output directory for downloaded emails
output = ~/mail
```

### Configuration Options

- `host` - IMAP server hostname
- `user` or `username` - Email username
- `password` or `pass` - Email password
- `output` or `dir` or `directory` - Output directory for emails
- `port` - IMAP server port (default: 993)
- `tls` - Use TLS (default: true)
- `box` or `mailbox` - Mailbox to download (default: INBOX)

## Usage

### Download emails

```bash
# Using config file
bun run index.ts fetch

# Or with command-line options (override config)
bun run index.ts fetch -h imap.example.com -u user@example.com -p password -o ~/mail

# Limit number of emails
bun run index.ts fetch --limit 10
```

### Index emails

After downloading emails, create a SQLite index for fast searching:

```bash
# Using config file
bun run index.ts index

# Or with command-line options
bun run index.ts index -o ~/mail

# Verbose mode
bun run index.ts index -o ~/mail -v
```

The index is stored in `mail_folder/index.sqlite` with the following schema:

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
  YYYY-MM/        # Year-Month folder
    uid.eml       # Individual email file
```

For example:
```
~/mail/
  2024-01/
    1.eml
    2.eml
  2024-02/
    3.eml
```

## Development

```bash
# Run directly
bun run index.ts [command]

# Install globally
bun link
maik [command]
```