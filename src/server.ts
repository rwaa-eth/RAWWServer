import fastify from "fastify";
import { FastifyInstance } from "fastify/types/instance";
import { ethers } from "ethers";
// @ts-ignore
import { INFURA_KEY, NAME_LIMIT } from "./constants";
import fs from "fs";
import cors from "@fastify/cors";
import Redis from "ioredis";
import path from "path";
import { FastifyRequest } from "fastify";
import multipart from '@fastify/multipart';

const CHALLENGE_STRINGS = ["Rwaa", "Landmass", "Kuiper", "Tractor", "Scythe"];
const redis = new Redis();
interface ChallengeEntry {
  challenge: string;
  timestamp: number;
}

type ChainDetail = {
  name: string;
  RPCurl: string;
  chainId: number;
};

const SERVER_CHAIN_ID = 11155931;

const CHAIN_DETAILS: Record<number, ChainDetail> = {
  1: {
    name: "mainnet",
    RPCurl: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
  },
  5: {
    name: "goerli",
    RPCurl: `https://goerli.infura.io/v3/${INFURA_KEY}`,
    chainId: 5,
  },
  11155111: {
    name: "sepolia",
    RPCurl: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 11155111,
  },
  17000: {
    name: "holesky",
    RPCurl: `https://holesky.infura.io/v3/${INFURA_KEY}`,
    chainId: 17000,
  },
  42161: {
    name: "arbitrum-mainnet",
    RPCurl: `https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 42161,
  },
  80001: {
    name: "polygon-mumbai",
    RPCurl: `https://polygon-mumbai.infura.io/v3/${INFURA_KEY}`,
    chainId: 80001,
  },
  137: {
    name: "polygon-mainnet",
    RPCurl: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 137,
  },
  10: {
    name: "optimism-mainnet",
    RPCurl: `https://optimism-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 10,
  },
  11155931: {
		RPCurl: 'https://testnet.riselabs.xyz',
		name: 'rise-sepolia',
    chainId: 11155931,
	},

};

const challenges: ChallengeEntry[] = [];

// TODO: Alan replace with persistant storage
const keyMapping: Map<number, string> = new Map(); // Document ID -> key

const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0xefAB18061C57C458c52661f50f5b83B600392ed6";

const challengeExpiry = 60 * 60 * 2 * 1000; // 2 hours in milliseconds
async function createServer() {
  let app: FastifyInstance;
  //let lastError: string[] = [];
  //let coinTypeRoute: string[] = [];

  // app = fastify({
  //   maxParamLength: 1024,
  //   ...(process.env.NODE_ENV !== "development"
  //     ? {
  //         https: {
  //           key: fs.readFileSync("/etc/letsencrypt/live/ra.ath.cx/privkey.pem"),
  //           cert: fs.readFileSync(
  //             "/etc/letsencrypt/live/ra.ath.cx/fullchain.pem"
  //           ),
  //         },
  //       }
  //     : {}),
  // });

  app = fastify({
    maxParamLength: 1024,
    ...(process.env.NODE_ENV !== "development"
      ? {
          https: {
            key: fs.readFileSync("/etc/letsencrypt/live/scriptproxy.smarttokenlabs.com/privkey.pem"),
            cert: fs.readFileSync(
              "/etc/letsencrypt/live/scriptproxy.smarttokenlabs.com/fullchain.pem"
            ),
          },
        }
      : {}),
  });

  app.register(multipart);

  await app.register(cors, {
    origin: "*",
    // put your options here
  });

  /*app = fastify({
        maxParamLength: 1024
    });*/

  app.get("/challenge", async (request, reply) => {
    //create a challenge string consisting of a random word selected from CHALLENGE_STRINGS followed by a random hex string
    //form a random hex string of length 10 characters
    let challenge =
      CHALLENGE_STRINGS[Math.floor(Math.random() * CHALLENGE_STRINGS.length)] +
      "-" +
      Math.random().toString(36).substring(2, 15);
    challenges.push({ challenge, timestamp: Date.now() });
    console.log("challenges", challenges);
    return { data: `${challenge}` };
  });

  app.post(`/verify`, async (request, reply) => {
    //recover the address from the signature
    // @ts-ignore
    const { signature, tokenId } = request.body;
    console.log("verify", signature, tokenId);
    console.log("challenges", challenges);

    const numericTokenId = parseInt(tokenId);
    console.log("numericTokenId", numericTokenId);

    const ownsToken = await checkOwnership(signature, numericTokenId);

    if (ownsToken) {
      // get document id
      try {
        const documentId = await getDocumentId(numericTokenId);
        console.log("documentId", `${documentId}`);
        // const decryptKey = keyMapping.get(documentId); // TODO: Alan replace with persistant storage
        const decryptKey = await redis.get(`${documentId}`);
        console.log("decryptKey", decryptKey);
        return { data: `${decryptKey}` };
      } catch (e) {
        return { data: `Document not found` };
      }
    } else {
      return reply.status(500).send({ data: `NFT not owned` });
    }
  });

  app.post("/register-file", async (request, reply) => {
    console.log("Received request for /register-file");
    try {
      const downloadsFolder = path.join(__dirname, "downloads");
      if (!fs.existsSync(downloadsFolder)) {
            fs.mkdirSync(downloadsFolder);
      }
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ data: `No file data received` });
      }
      const fileBuffer = await data.toBuffer();
      const fileHash = ethers.keccak256(fs.readFileSync(fileBuffer));
      console.log("fileHash", fileHash);

      const filePath = path.join(downloadsFolder, fileHash);
      
      //store the file in the downloads folder
      fs.writeFileSync(filePath, fileHash);

      //now return the file hash
      return { data: `${fileHash}` };
    } catch (e) {
      return reply.status(500).send({ data: `Error processing file` });
    }
  });

  //accept multipart file upload
  /*app.post("/register-file", async (request, reply) => {
    console.log("Received request for /register-file");
    try {
      const data = await request.multipart(async (field, file) => {
        // Handle the file upload
        if (field === 'file') {
          // now store the file in the downloads folder
          const downloadsFolder = path.join(__dirname, "downloads");
          if (!fs.existsSync(downloadsFolder)) {
            fs.mkdirSync(downloadsFolder);
          }

          //now store the file in the downloads folder
          const filePath = path.join(downloadsFolder, file.filename);
          fs.writeFileSync(filePath, file.data);

          //now need to use ethers to create a hash of the file
    //const filePath = path.join(downloadsFolder, request.body.file.filename); // Change request.file to request.body.file
    //fs.writeFileSync(filePath, request.body.file.data); // Change request.file to request.body.file

    //now need to use ethers to create a hash of the file
    const fileHash = ethers.keccak256(fs.readFileSync(filePath));
    console.log("fileHash", fileHash);
    // now return the file hash
        return { data: `${fileHash}` };
      }
    }) 
    } catch (e) {
      return reply.status(500).send({ data: `Error processing file` });
    }
  });*/

  //http://localhost:8080/register/<DOCUMENTID>/<AES256 KEY>
  app.post("/register-key", async (request, reply) => {
    console.log("Received request for /register-key");
    // @ts-ignore
    const { docId, aesKey } = request.body;
    console.log(`Received docId: ${docId}, aesKey: ${aesKey}`);
    // TODO: Alan replace with persistant storage
    // keyMapping.set(parseInt(docId), aesKey);
    console.log("Setting key in Redis");
    const setRes = await redis.set(`${docId}`, `${aesKey}`);
    console.log(`Redis set result: ${setRes}`);
    const firstDigit = aesKey[0];
    const lastDigit = aesKey[aesKey.length - 1];
    console.log(
      `First digit of aesKey: ${firstDigit}, Last digit of aesKey: ${lastDigit}`
    );
    console.log(
      `setRes ${setRes} docId ${docId} aesKey ${firstDigit}...${lastDigit}`
    );
    console.log("Returning success response");
    return { data: `pass` };
  });

  console.log("Returning app from function");
  return app;
}

async function getDocumentId(tokenId: number): Promise<number> {
  const provider = getProvider(SERVER_CHAIN_ID);
  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function getDocIdbyTokenId(uint256 tokenId) view returns (uint256)"],
    provider
  );

  return await queryContract.getDocIdbyTokenId(tokenId);
}

function getProvider(useChainId: number): ethers.JsonRpcProvider | null {
  console.log("getProvider useChainId", useChainId);
  const chainDetails: ChainDetail = CHAIN_DETAILS[useChainId];

  console.log(`CHAIN chainDetails ${JSON.stringify(chainDetails)}`);

  if (chainDetails !== null) {
    return new ethers.JsonRpcProvider(chainDetails.RPCurl, {
      chainId: chainDetails.chainId,
      name: chainDetails.name,
    });
  } else {
    return null;
  }
}

async function checkOwnership(
  signature: string,
  tokenId: number
): Promise<boolean> {
  //loop through all of the challenge strings which are still valid
  const tokenOwner = await getTokenOwner(tokenId);
  console.log(`tokenOwner ${tokenOwner} tokenID ${tokenId}`);
  console.log("challenges tokenOwner", challenges);
  for (let i = 0; i < challenges.length; i++) {
    const thisChallenge = challenges[i];
    console.log(
      "thisChallenge",
      thisChallenge,
      thisChallenge.timestamp + challengeExpiry > Date.now()
    );
    if (thisChallenge.timestamp + challengeExpiry > Date.now()) {
      //recover the address
      const address = ethers.verifyMessage(
        thisChallenge.challenge,
        addHexPrefix(signature)
      );
      console.log("address", address);
      console.log("tokenOwner", tokenOwner);

      if (address.toLowerCase() === tokenOwner.toLowerCase()) {
        //if the address matches the token owner, return true
        //remove entry from challenges
        challenges.splice(i, 1);
        return true;
      }
    } else {
      //remove expired entry
      challenges.splice(i, 1);
      //begin from start again
      i = 0;
    }
  }

  return false;
}

async function getTokenOwner(tokenId: number): Promise<string> {
  console.log("getTokenOwner", tokenId);
  const provider = getProvider(SERVER_CHAIN_ID);
  console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function ownerOf(uint256 tokenId) view returns (address)"],
    provider
  );

  console.log("queryContract", queryContract);
  try {
    return await queryContract.ownerOf(tokenId);
  } catch (e) {
    console.log("error", e);
    return "";
  }
}

function addHexPrefix(hex: string): string {
  if (hex.startsWith("0x")) {
    return hex;
  } else {
    return "0x" + hex;
  }
}

const start = async () => {
  try {
    const app = await createServer();

    const host = "0.0.0.0";
    const port = process.env.NODE_ENV === "development" ? 8080 : 8086;
    await app.listen({ port, host });
    console.log(`Server is listening on ${host} ${port}`);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

start();
