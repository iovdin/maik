#!/usr/bin/env node

const { Command } = require('commander');
const { 
  loadConfig, 
  mergeConfig, 
  connectToImap, 
  ensureDirectory, 
  formatDate, 
  getLatestUid,
  downloadEmails,
  parseEmails,
  indexEmails
} = require('./index.js');

const program = new Command();

program
  .name('maik')
  .description('CLI tool to download and index emails from IMAP server')
  .version('1.0.0');

// Fetch command
program
  .command('fetch')
  .description('Download emails from IMAP server to local folder')
  .option('-h, --host <host>', 'IMAP server hostname')
  .option('-u, --user <user>', 'Email username')
  .option('-p, --password <password>', 'Email password')
  .option('-o, --output <directory>', 'Output directory for emails')
  .option('-v, --verbose', 'Show detailed progress', false)
  .option('--port <port>', 'IMAP server port', '993')
  .option('--tls', 'Use TLS', true)
  .option('--box <mailbox>', 'Mailbox to download', 'INBOX')
  .option('--limit <number>', 'Limit number of emails to download', '0')
  .action(async (options) => {
    const config = await loadConfig();
    const mergedOptions = mergeConfig(options, config);
    await downloadEmails(mergedOptions);
  });

// Parse command
program
  .command('parse')
  .description('Parse source.eml files and extract body.txt, body.html, and attachments')
  .option('-o, --output <directory>', 'Mail folder directory')
  .option('-v, --verbose', 'Show detailed progress', false)
  .action(async (options) => {
    const config = await loadConfig();
    const mergedOptions = mergeConfig(options, config);
    await parseEmails(mergedOptions);
  });

// Index command
program
  .command('index')
  .description('Index .eml files into SQLite database')
  .option('-o, --output <directory>', 'Mail folder directory')
  .option('-v, --verbose', 'Show detailed progress', false)
  .option('--clean', 'Remove existing index database and re-index everything', false)
  .action(async (options) => {
    const config = await loadConfig();
    const mergedOptions = mergeConfig(options, config);
    await indexEmails(mergedOptions);
  });

// Parse and run
program.parse();
