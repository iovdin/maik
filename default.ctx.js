const { loadConfig, getDb } =  require('./index.js')
const path = require("path")
const fs = require("fs")
const PostalMime = require('postal-mime');
let config

module.exports = async function maik(name, args) {
  if (!config) {
    config = await loadConfig()
  }

  // should start with prefix
  if (name.indexOf("mail/") !== 0) {
    return
  }

  if (name === "mail/dir") {
    return {
      type: "text",
      read: async () => config.output
    }
  }

  const [_, month, uid, filename] = name.split("/")
  const sourcePath = path.resolve(config.output, month, uid, "source.eml")

  if (!fs.existsSync(sourcePath)) {
    return
  }

  if (filename === "source.eml") {
    return {
      name,
      type: "text",
      source: "maik",
      read: async() => fs.readFileSync(sourcePath, "utf8")
    }
  }

  const content = fs.readFileSync(sourcePath, "utf8")

  // Parse with PostalMime
  const email = await PostalMime.parse(content);
  let mimetype
  let type
  let value

  if (filename === "body.txt") {
    mimetype = "text/plain"
    type = "text"
    value = email.text
  } else if (filename === "body.html"){ 
    mimetype = "text/html"
    type = "text"
    value = email.html
  } else {
    const attachment = email.attachments.find(item => item.filename === filename)
    if (attachment) {
      mimetype = attachment.mimeType
      value = Buffer.from(attachment.content)
      if (mimetype.indexOf("text") === 0) {
        type = "text"
        value = value.toString("utf8")
      } else if (mimetype.indexOf("image") === 0) {
        type = "image"
      } else {
        type = "binary"
      }
    }
  }

  const result = {
    name,
    type,
    mimetype,
    source: "maik",
    read: async () => value 
  }
  return  result 
}
