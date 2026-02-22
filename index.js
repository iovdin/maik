const { ImapFlow } = require('imapflow');
const { mkdir, writeFile, readdir, stat, readFile, unlink } = require('fs/promises');
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const PostalMime = require('postal-mime');

function getConfigPath() {
  return path.join(os.homedir(), '.config', 'maik', 'config.txt');
}

async function loadConfig() {
  const configPath = getConfigPath();
  const config = {};
  
  if (!existsSync(configPath)) {
    return config;
  }
  
  try {
    const content = await readFile(configPath, 'utf-8');
    const lines = content.split('\n');
    
    for (let line of lines) {
      line = line.trim();
      
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) {
        continue;
      }
      
      const equalIndex = line.indexOf('=');
      if (equalIndex > 0) {
        const key = line.substring(0, equalIndex).trim().toLowerCase();
        const value = line.substring(equalIndex + 1).trim();
        
        // Map config keys to options
        switch (key) {
          case 'host':
            config.host = value;
            break;
          case 'user':
          case 'username':
            config.user = value;
            break;
          case 'password':
          case 'pass':
            config.password = value;
            break;
          case 'output':
          case 'dir':
          case 'directory':
            config.output = value;
            break;
          case 'port':
            config.port = value;
            break;
          case 'tls':
            config.tls = value.toLowerCase() === 'true';
            break;
          case 'box':
          case 'mailbox':
            config.box = value;
            break;
        }
      }
    }
  } catch (error) {
    // Ignore errors, return empty config
  }

  if (config.output) {
    config.output = expandHome(config.output)
  }
  
  return config;
}

function expandHome(p) {
  if (!p) return p;
  // Only expand a leading ~ or ~/...
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function mergeConfig(options, config) {
  return {
    host: options.host || config.host,
    user: options.user || config.user,
    password: options.password || config.password,
    output: expandHome(options.output || config.output),
    port: options.port || config.port || '993',
    tls: options.tls !== undefined ? options.tls : (config.tls !== undefined ? config.tls : true),
    box: options.box || config.box || 'INBOX',
    limit: options.limit || '0',
    verbose: options.verbose || false,
    clean: options.clean || false
  };
}

async function connectToImap(options) {
  // Validate required options
  if (!options.host) {
    console.error('Error: host is required (set in config or pass via --host)');
    process.exit(1);
  }
  if (!options.user) {
    console.error('Error: user is required (set in config or pass via --user)');
    process.exit(1);
  }
  if (!options.password) {
    console.error('Error: password is required (set in config or pass via --password)');
    process.exit(1);
  }

  const client = new ImapFlow({
    host: options.host,
    port: parseInt(options.port),
    secure: options.tls,
    auth: {
      user: options.user,
      pass: options.password
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: (msg) => console.log('Warning:', msg),
      error: (msg) => console.log('Error:', msg)
    }
  });

  console.log(`Connecting to ${options.host}:${options.port}...`);
  console.log(`User: ${options.user}`);
  
  try {
    await client.connect();
    console.log('Connected successfully!');
    return client;
  } catch (error) {
    console.error('\nConnection failed!');
    console.error('Error details:', error.message || error);
    throw error;
  }
}

async function ensureDirectory(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function getLatestUid(outputDir) {
  if (!existsSync(outputDir)) {
    return 0;
  }
  
  let maxUid = 0;
  
  try {
    const dateFolders = await readdir(outputDir);
    
    for (const folder of dateFolders) {
      const folderPath = path.join(outputDir, folder);
      const folderStats = await stat(folderPath);
      
      // Skip if not a directory
      if (!folderStats.isDirectory()) {
        continue;
      }
      
      const files = await readdir(folderPath);
      
      for (const file of files) {
        // Extract UID from filename (format: uid.eml)
        const match = file.match(/^(\d+)\.eml$/);
        if (match) {
          const uid = parseInt(match[1]);
          if (uid > maxUid) {
            maxUid = uid;
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors, return 0
  }
  
  return maxUid;
}

async function getLatestUidNew(outputDir) {
  if (!existsSync(outputDir)) {
    return 0;
  }
  
  let maxUid = 0;
  
  try {
    const dateFolders = await readdir(outputDir);
    
    for (const folder of dateFolders) {
      const folderPath = path.join(outputDir, folder);
      const folderStats = await stat(folderPath);
      
      // Skip if not a directory
      if (!folderStats.isDirectory()) {
        continue;
      }
      
      // Look for UID directories (not .eml files anymore)
      const uidDirs = await readdir(folderPath);
      
      for (const uidDir of uidDirs) {
        // Check if it's a numeric directory name (UID)
        const uidNum = parseInt(uidDir);
        if (!isNaN(uidNum) && uidNum > 0) {
          const uidPath = path.join(folderPath, uidDir);
          try {
            const uidStats = await stat(uidPath);
            if (uidStats.isDirectory() && uidNum > maxUid) {
              maxUid = uidNum;
            }
          } catch {
            // Ignore errors
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors, return 0
  }
  
  return maxUid;
}

async function saveEmailSource(source, uidDir, verbose) {
  // Save original source only
  const sourcePath = path.join(uidDir, 'source.eml');
  await writeFile(sourcePath, source);
  if (verbose) console.log(`  -> source.eml (${source.length} bytes)`);
}

async function extractEmailParts(uidDir, verbose) {
  const sourcePath = path.join(uidDir, 'source.eml');
  
  if (!existsSync(sourcePath)) {
    return null;
  }
  
  // Read and parse the email with PostalMime
  const source = await readFile(sourcePath);
  const email = await PostalMime.parse(source);
  
  // Save text body
  if (email.text) {
    const textPath = path.join(uidDir, 'body.txt');
    await writeFile(textPath, email.text);
    if (verbose) console.log(`  -> body.txt (${email.text.length} chars)`);
  }
  
  // Save html body
  if (email.html) {
    const htmlPath = path.join(uidDir, 'body.html');
    await writeFile(htmlPath, email.html);
    if (verbose) console.log(`  -> body.html (${email.html.length} chars)`);
  }
  
  // Save attachments
  let attachmentCount = 0;
  if (email.attachments && email.attachments.length > 0) {
    for (const att of email.attachments) {
      const filename = att.filename || `attachment-${attachmentCount + 1}`;
      const attPath = path.join(uidDir, filename);
      
      // Handle filename conflicts
      let finalPath = attPath;
      let counter = 1;
      while (existsSync(finalPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        finalPath = path.join(uidDir, `${base}-${counter}${ext}`);
        counter++;
      }
      
      await writeFile(finalPath, att.content);
      attachmentCount++;
      if (verbose) console.log(`  -> ${path.basename(finalPath)} (${att.mimeType}, ${att.content.length} bytes)`);
    }
  }
  
  return {
    hasText: !!email.text,
    hasHtml: !!email.html,
    attachmentCount,
    subject: email.subject || 'No Subject'
  };
}

async function downloadEmails(options) {
  // Validate output directory
  if (!options.output) {
    console.error('Error: output directory is required (set in config or pass via --output)');
    process.exit(1);
  }

  const client = await connectToImap(options);
  
  try {
    // Select mailbox
    await client.mailboxOpen(options.box);
    console.log(`Opened mailbox: ${options.box}`);
    
    // Get total message count
    const status = await client.status(options.box, { messages: true });
    const totalMessages = status.messages || 0;
    console.log(`Total messages in ${options.box}: ${totalMessages}`);
    
    if (totalMessages === 0) {
      console.log('No messages to download.');
      return;
    }
    
    // Scan for latest UID
    console.log('Scanning for existing emails...');
    const latestUid = await getLatestUidNew(options.output);
    
    if (latestUid > 0) {
      console.log(`Latest downloaded UID: ${latestUid}`);
    } else {
      console.log('No existing emails found, will download all');
    }
    
    const limit = parseInt(options.limit);
    let processed = 0;
    let saved = 0;
    let lastValidDate = null;
    const now = new Date();
    
    // Create output directory
    await ensureDirectory(options.output);
    
    // Determine fetch range - only fetch UIDs greater than latestUid
    const fetchRange = latestUid > 0 ? `${latestUid + 1}:*` : '1:*';
    
    // Fetch messages
    for await (const message of client.fetch(fetchRange, { 
      envelope: true, 
      source: true,
      internalDate: true
    }, { 
      uid: true
    })) {
      try {
        processed++;
        
        // Get date from internal date or envelope
        let emailDate = message.internalDate || new Date(message.envelope.date);
        
        if (isNaN(emailDate.getTime())) {
          console.log(`Skipping message ${processed} - invalid date`);
          continue;
        }
        
        // Check if date is in the future
        if (emailDate > now) {
          if (lastValidDate) {
            if (options.verbose) {
              console.log(`  Date ${emailDate.toISOString()} is in the future, using ${lastValidDate.toISOString()}`);
            }
            emailDate = lastValidDate;
          } else {
            // If no last valid date, use current date
            if (options.verbose) {
              console.log(`  Date is in the future, using current date`);
            }
            emailDate = now;
          }
        } else {
          // Update last valid date
          lastValidDate = emailDate;
        }
        
        const dateFolder = formatDate(emailDate);
        const datePath = path.join(options.output, dateFolder);
        
        // Create date folder
        await ensureDirectory(datePath);
        
        // Create UID directory
        const uid = message.uid;
        const uidDir = path.join(datePath, String(uid));
        await ensureDirectory(uidDir);
        
        // Save source.eml only
        const subject = message.envelope.subject || 'No Subject';
        await saveEmailSource(message.source, uidDir, options.verbose);
        
        saved++;
        console.log(`Saved [${saved}]: ${dateFolder}/${uid} - "${subject.substring(0, 50)}"`);
        
        // Check limit
        if (limit > 0 && saved >= limit) {
          console.log(`\nReached limit of ${limit} emails`);
          break;
        }
        
      } catch (error) {
        console.error(`Error processing message:`, error);
      }
    }
    
    console.log(`\nDownload complete!`);
    console.log(`Downloaded: ${saved} new messages`);
    if (latestUid > 0 && saved === 0) {
      console.log('No new emails to download (already up to date)');
    }
    
  } finally {
    await client.logout();
    console.log('\nDisconnected from server.');
  }
}

// Email parsing utilities using PostalMime
async function parseEmailHeadersFast(filePath) {
  // Read the email file
  const emailContent = await readFile(filePath, 'utf-8');
  
  // Parse with PostalMime
  const email = await PostalMime.parse(emailContent);
  
  // Extract sender info
  const sender = email.from ? (typeof email.from === 'object' && 'address' in email.from ? email.from.address : '') : '';
  const sender_name = email.from && typeof email.from === 'object' && 'name' in email.from ? email.from.name : '';
  
  // Extract recipients
  const to = email.to 
    ? (Array.isArray(email.to) 
        ? email.to.map(addr => typeof addr === 'object' && 'address' in addr ? addr.address : '').join(', ')
        : '')
    : '';
  
  const cc = email.cc 
    ? (Array.isArray(email.cc) 
        ? email.cc.map(addr => typeof addr === 'object' && 'address' in addr ? addr.address : '').join(', ')
        : '')
    : '';
  
  const bcc = email.bcc 
    ? (Array.isArray(email.bcc) 
        ? email.bcc.map(addr => typeof addr === 'object' && 'address' in addr ? addr.address : '').join(', ')
        : '')
    : '';
  
  const reply_to = email.replyTo 
    ? (Array.isArray(email.replyTo) 
        ? email.replyTo.map(addr => typeof addr === 'object' && 'address' in addr ? addr.address : '').join(', ')
        : (typeof email.replyTo === 'object' && 'address' in email.replyTo ? email.replyTo.address : ''))
    : '';
  
  // Extract attachments (filename + mimeType)
  const attachments = email.attachments 
    ? email.attachments.map(att => `${att.filename || 'unnamed'}:${att.mimeType}`).join(', ')
    : '';
  
  // Extract received-spf from headers
  const received_spf_header = email.headers.find(h => h.key === 'received-spf');
  const received_spf = received_spf_header ? received_spf_header.value : '';
  
  return {
    date: email.date || '',
    sender,
    sender_name,
    to,
    subject: email.subject || '',
    message_id: email.messageId || '',
    in_reply_to: email.inReplyTo || '',
    refs: email.references || '',
    cc,
    bcc,
    reply_to,
    delivered_to: email.deliveredTo || '',
    attachments,
    received_spf
  };
}

function getDb(outputDir) {
  const dbPath = path.join(outputDir, 'index.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

async function indexEmails(options) {
  // Validate output directory
  if (!options.output) {
    console.error('Error: output directory is required (set in config or pass via --output)');
    process.exit(1);
  }

  const outputDir = options.output;
  const verbose = options.verbose;
  const clean = options.clean;
  
  if (!existsSync(outputDir)) {
    console.error(`Error: Directory '${outputDir}' does not exist`);
    process.exit(1);
  }
  
  const dbPath = path.join(outputDir, 'index.sqlite');
  
  // Handle --clean option: remove existing database
  if (clean && existsSync(dbPath)) {
    console.log('Clean mode: removing existing index database...');
    
    // Remove main database file
    await unlink(dbPath);
    
    // Remove WAL and SHM files if they exist
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    
    if (existsSync(walPath)) {
      await unlink(walPath);
    }
    if (existsSync(shmPath)) {
      await unlink(shmPath);
    }
    
    console.log('Database removed successfully.\n');
  }
  
  const db = getDb(outputDir);
  
  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      uid INTEGER PRIMARY KEY,
      date INTEGER,
      sender TEXT,
      sender_name TEXT,
      "to" TEXT,
      subject TEXT,
      size INTEGER,
      message_id TEXT,
      in_reply_to TEXT,
      refs TEXT,
      cc TEXT,
      bcc TEXT,
      reply_to TEXT,
      delivered_to TEXT,
      attachments TEXT,
      received_spf TEXT
    )
  `);
  
  // Create index on frequently queried columns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to)`);
  
  // Get existing UIDs
  const existingRows = db.prepare('SELECT uid FROM emails').all();
  const existingUids = new Set(existingRows.map(row => row.uid));
  
  console.log(`Database: ${dbPath}`);
  console.log(`Already indexed: ${existingUids.size} emails`);
  
  let totalFiles = 0;
  let newFiles = 0;
  let skippedFiles = 0;
  let errorFiles = 0;
  
  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT INTO emails (
      uid, date, sender, sender_name, "to", subject, size,
      message_id, in_reply_to, refs, cc, bcc, reply_to,
      delivered_to, attachments, received_spf
    ) VALUES (
      @uid, @date, @sender, @sender_name, @to, @subject, @size,
      @message_id, @in_reply_to, @refs, @cc, @bcc, @reply_to,
      @delivered_to, @attachments, @received_spf
    )
  `);
  
  // Use transaction for batch inserts
  const insertMany = db.transaction((emails) => {
    for (const email of emails) {
      insertStmt.run(email);
    }
  });
  
  // Collect emails to insert for batch processing
  let batch = [];
  
  try {
    const dateFolders = (await readdir(outputDir)).sort();
    
    for (const folder of dateFolders) {
      const folderPath = path.join(outputDir, folder);
      const folderStats = await stat(folderPath);
      
      // Skip if not a directory
      if (!folderStats.isDirectory()) {
        continue;
      }
      
      // Look for UID directories
      const uidDirs = (await readdir(folderPath)).sort();
      
      for (const uidDir of uidDirs) {
        // Check if it's a numeric directory name (UID)
        const uid = parseInt(uidDir);
        if (isNaN(uid) || uid <= 0) {
          continue;
        }
        
        const uidPath = path.join(folderPath, uidDir);
        let uidStats;
        try {
          uidStats = await stat(uidPath);
        } catch {
          continue;
        }
        
        // Skip if not a directory
        if (!uidStats.isDirectory()) {
          continue;
        }
        
        // Look for source.eml inside the UID directory
        const sourcePath = path.join(uidPath, 'source.eml');
        if (!existsSync(sourcePath)) {
          if (verbose) {
            console.log(`Skipping ${folder}/${uidDir} - no source.eml found`);
          }
          skippedFiles++;
          continue;
        }
        
        totalFiles++;
        
        // Check if already indexed
        if (existingUids.has(uid)) {
          if (verbose) {
            console.log(`Skipping ${folder}/${uidDir} - already indexed`);
          }
          continue;
        }
        
        // Parse the email file
        try {
          const fileStats = await stat(sourcePath);
          const headers = await parseEmailHeadersFast(sourcePath);
          
          // Convert date string to Unix timestamp
          let dateTimestamp = 0;
          if (headers.date) {
            const parsedDate = new Date(headers.date);
            if (!isNaN(parsedDate.getTime())) {
              dateTimestamp = Math.floor(parsedDate.getTime() / 1000);
            }
          }
          
          // Collect for batch insert
          batch.push({
            uid: uid,
            date: dateTimestamp,
            sender: headers.sender,
            sender_name: headers.sender_name,
            to: headers.to,
            subject: headers.subject,
            size: fileStats.size,
            message_id: headers.message_id,
            in_reply_to: headers.in_reply_to,
            refs: headers.refs,
            cc: headers.cc,
            bcc: headers.bcc,
            reply_to: headers.reply_to,
            delivered_to: headers.delivered_to,
            attachments: headers.attachments,
            received_spf: headers.received_spf
          });
          
          newFiles++;
          
          // Batch insert every 1000 emails
          if (newFiles % 1000 === 0) {
            console.log(`Parsed ${newFiles} new emails..., inserting`);
            insertMany(batch);
            batch = [];
          }
        } catch (error) {
          console.error(`Error parsing ${folder}/${uidDir}/source.eml:`, error);
          errorFiles++;
        }
      }
    }
    
    // Insert remaining emails
    if (batch.length > 0) {
      insertMany(batch);
    }
    
    // Get final count
    console.log(`\nIndexing complete!`);
    console.log(`Total .eml files found: ${totalFiles}`);
    console.log(`New emails indexed: ${newFiles}`);
    console.log(`Skipped (already indexed): ${totalFiles - newFiles - errorFiles}`);
    if (errorFiles > 0) {
      console.log(`Errors: ${errorFiles}`);
    }
    
  } finally {
    db.close();
  }
}

async function parseEmails(options) {
  // Validate output directory
  if (!options.output) {
    console.error('Error: output directory is required (set in config or pass via --output)');
    process.exit(1);
  }

  const outputDir = options.output;
  const verbose = options.verbose;
  
  if (!existsSync(outputDir)) {
    console.error(`Error: Directory '${outputDir}' does not exist`);
    process.exit(1);
  }
  
  console.log(`Parsing emails in: ${outputDir}`);
  
  let totalDirs = 0;
  let parsedDirs = 0;
  let skippedDirs = 0;
  let errorDirs = 0;
  let totalAttachments = 0;
  let totalText = 0;
  let totalHtml = 0;
  
  try {
    const dateFolders = (await readdir(outputDir)).sort();
    
    for (const folder of dateFolders) {
      const folderPath = path.join(outputDir, folder);
      const folderStats = await stat(folderPath);
      
      // Skip if not a directory
      if (!folderStats.isDirectory()) {
        continue;
      }
      
      // Look for UID directories
      const uidDirs = (await readdir(folderPath)).sort();
      
      for (const uidDir of uidDirs) {
        // Check if it's a numeric directory name (UID)
        const uid = parseInt(uidDir);
        if (isNaN(uid) || uid <= 0) {
          continue;
        }
        
        const uidPath = path.join(folderPath, uidDir);
        let uidStats;
        try {
          uidStats = await stat(uidPath);
        } catch {
          continue;
        }
        
        // Skip if not a directory
        if (!uidStats.isDirectory()) {
          continue;
        }
        
        // Check if source.eml exists
        const sourcePath = path.join(uidPath, 'source.eml');
        if (!existsSync(sourcePath)) {
          if (verbose) {
            console.log(`Skipping ${folder}/${uidDir} - no source.eml found`);
          }
          skippedDirs++;
          continue;
        }
        
        // Check if already parsed (has body.txt or body.html)
        const bodyTxtPath = path.join(uidPath, 'body.txt');
        const bodyHtmlPath = path.join(uidPath, 'body.html');
        if (existsSync(bodyTxtPath) || existsSync(bodyHtmlPath)) {
          if (verbose) {
            console.log(`Skipping ${folder}/${uidDir} - already parsed`);
          }
          continue;
        }
        
        totalDirs++;
        
        // Parse the email
        try {
          const result = await extractEmailParts(uidPath, verbose);
          
          if (result) {
            parsedDirs++;
            if (result.hasText) totalText++;
            if (result.hasHtml) totalHtml++;
            totalAttachments += result.attachmentCount;
            
            console.log(`Parsed [${parsedDirs}]: ${folder}/${uidDir} - "${result.subject.substring(0, 50)}"`);
          }
        } catch (error) {
          console.error(`Error parsing ${folder}/${uidDir}:`, error);
          errorDirs++;
        }
      }
    }
    
    console.log(`\nParsing complete!`);
    console.log(`Emails parsed: ${parsedDirs}`);
    console.log(`  - with text body: ${totalText}`);
    console.log(`  - with html body: ${totalHtml}`);
    console.log(`  - total attachments: ${totalAttachments}`);
    if (skippedDirs > 0) {
      console.log(`Skipped (no source.eml): ${skippedDirs}`);
    }
    if (errorDirs > 0) {
      console.log(`Errors: ${errorDirs}`);
    }
    
  } catch (error) {
    console.error('Error parsing emails:', error);
    process.exit(1);
  }
}

module.exports = {
  loadConfig,
  mergeConfig,
  connectToImap,
  ensureDirectory,
  formatDate,
  getLatestUid,
  getLatestUidNew,
  saveEmailSource,
  extractEmailParts,
  downloadEmails,
  parseEmails,
  indexEmails,
  parseEmailHeadersFast,
  getDb
};
