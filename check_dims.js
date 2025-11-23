const fs = require("fs");
const path = require("path");

const imagePath = path.join(__dirname, "susie_andando.png");

function getPngDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(24);
    fs.readSync(fd, buffer, 0, 24, 0);
    fs.closeSync(fd);

    if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
      console.log("Not a PNG file");
      return null;
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  } catch (e) {
    console.error(e);
    return null;
  }
}

const dims = getPngDimensions(imagePath);
if (dims) {
  console.log(`Width: ${dims.width}, Height: ${dims.height}`);
}
