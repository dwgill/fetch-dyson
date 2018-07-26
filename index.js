const puppeteer = require("puppeteer");
const minimist = require("minimist");
const _ = require("lodash");
const { promisify } = require("util");
const fs = require("fs");
const axios = require("axios");
const Path = require("path");

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

const normalQuotes = str => str.replace(/[\u2018\u2019]/g, "'");

async function run() {
  const urls = getUrlsToScrape();
  try {
    browser = await puppeteer.launch();
    await Promise.all(urls.map(scrapeUrl(browser)));
  } catch (e) {
    console.error(e);
  } finally {
    if (browser) {
      browser.close();
    }
    process.exit();
  }
}

function getUrlsToScrape() {
  const args = minimist(process.argv.slice(2));
  return args._;
}

/**
 * @param {String} imgUrl The file extension, including the .
 */
function determineFileExtension(imgUrl) {
  return imgUrl.substring(imgUrl.lastIndexOf("."));
}

async function makeDirectory(title) {
  const advDir =
    process.env.FETCH_DYSON_SAVE_DIR ||
    Path.resolve(
      process.env.HOME || "~",
      "OneDrive",
      "Role-Playing Games",
      "adventures & campaigns & dungeons"
    );
  const dirName = `maps - dyson logos - ${title}`;
  const dirPath = Path.resolve(advDir, dirName);
  try {
    await mkdir(dirPath);
  } catch (err) {
    throw new Error("Directory already exists");
  }
  return dirPath;
}

async function downloadImage(imgUrl, destinationPath) {
  let response;
  try {
    response = await axios.request({
      method: "GET",
      url: imgUrl,
      responseType: "stream"
    });
  } catch (error) {
    console.error(error);
    return;
  }

  response.data.pipe(fs.createWriteStream(destinationPath));

  return new Promise((resolve, reject) => {
    response.data.on("end", () => {
      resolve();
    });

    response.data.on("error", () => {
      reject();
    });
  });
}

/**
 * @param {String} url
 * @param {String} title
 * @param {String} directoryPath The path to where all the pages images are being saved
 */
async function saveUrlFile(url, title, directoryPath) {
  const contents = `
[InternetShortcut]
URL=${url}
`.trim();

  const filePath = Path.resolve(directoryPath, `${title}.url`);

  await writeFile(filePath, contents);
}

/**
 * @param {puppeteer.Browser} browser
 */
const scrapeUrl = browser => async url => {
  let page;
  try {
    page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });

    /** @type String */
    const title = await page.title();

    const trimmedTitle = _.flow(
      title => title.substring(0, title.indexOf("|")),
      title => title.toLowerCase(),
      title => normalQuotes(title),
      title => title.replace(/-|–|—/g, " "), // All dashes are em dashes
      title => title.replace(/  +/, " "),
      title => title.trim()
    )(title);

    let pageDirectoryPath;
    try {
      pageDirectoryPath = await makeDirectory(trimmedTitle);
    } catch (error) {
      console.log(`skipping: ${trimmedTitle}`);
      return;
    }

    await saveUrlFile(url, trimmedTitle, pageDirectoryPath);

    /** @type String[] */
    const imgSrcs = await page.$$eval("img.size-full", imgTags =>
      imgTags.map(imgTag => imgTag.src)
    );

    const downloadPromses = _(imgSrcs)
      .filter(imgSrc => !imgSrc.includes("patreon-supported-banner"))
      .map(imgSrc => imgSrc.substring(0, imgSrc.indexOf("?")))
      .map((imgUrl, index, imgUrls) => {
        const ext = determineFileExtension(imgUrl);
        const filename =
          imgUrls.length > 1
            ? `${trimmedTitle} ${index}${ext}`
            : trimmedTitle.concat(ext);
        return {
          url: imgUrl,
          path: Path.resolve(pageDirectoryPath, filename)
        };
      })
      .map(({ url, path }) => downloadImage(url, path))
      .value();

    await Promise.all(downloadPromses);
    console.log(`downloaded: ${trimmedTitle}`);
  } catch (err) {
    console.error(err);
  } finally {
    if (page) {
      page.close();
    }
  }
};

run();
