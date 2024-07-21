// server.js
const WebSocket = require('ws');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const config = require('config');

const DNAME = "s6";
const serverMapping = config.get('serverMapping');
const registeredUsers = config.get('registeredUsers');

let LocalC = new Map();
let GlobalC = {};
let CstoS = {};
let Users = {};
const keys = {
    "aryan@s6": {
        "publicKey": "-----BEGIN PUBLIC KEY-----\r\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArF1Jjg1WVLHOL9rGPIXt\r\nh5fq0lpXUv27RQ8gH8vTezgzyG10K4mS6vfSru56LJGQFZ8RLOVLiTS2utWILPKV\r\n2dS0cizPd1KYxWSBINNbrRv/tKFpbkI0Jui33oNPmCcrdm4vjfWh1rSMPyvNsslE\r\nn0tbwu/ah2gTQLG4lZJv6rvxCdxEKgBy+omvfwEe3uTL3VrGiwWHjac9nvSz3pLa\r\n5QcQYb8l1Xh95KOifhz8lrSVboleK79HPMl+NIoUlvX69lMZ6u9SeMSl8UzoF437\r\nhyTw6GzMHdcx1ok0BuzhXd3xlLrwe/Cv7/x82Ll4DwBPrU4yROScPURKQ+vYANq5\r\nnwIDAQAB\r\n-----END PUBLIC KEY-----\r\n",
    },
    "ash@s6": {
        "publicKey": "-----BEGIN PUBLIC KEY-----\r\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArrnGzVd/yZ+QXrKw4iBo\r\ndYLErCVxCete87ISHQlfiuvrWXOSEJr4EDrkvMvPXU/vdqX0ASmQJBril5y4TatG\r\nwggeWYEO9QPPofIzV11FkOKUuvcRdiP1ZND0MneBjGDWwpDwVd2q8NZV3ZKfP1ya\r\nMz41yrVM+90F+DG8h/V2VDd3u1vfszMBEhfB2Yz7qVYOOqEnIDKn8ANPZVb/OMGX\r\nEIAObYZ3r5bRvwhY+uUEAeEo//euNaCQU5ISsmsR82AGM+AuB+sJK6kJPsuIrfZs\r\n0L4bypzpQ7F+oJ9Pooec5Z/tdXhC1k4uDUB47si2qP5tM0kK82qv7uvAodUxkOWD\r\nAwIDAQAB\r\n-----END PUBLIC KEY-----\r\n",
    },
    "shivang@s6": {
        "publicKey": "-----BEGIN PUBLIC KEY-----\r\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxsjgsC1qdBZGK9rPFK2N\r\nLfLhpfTrvlLF5eeLyWHR2SgozFIE8+mUUdbDXOofFJow4UL4+2YU1eT19rSmQeCe\r\na5AzQn3TLaNKdxe5qg6Owbq6OvFp3QWhovV19NsaBqoxCqYMkdy7yW0eEoYkiPmD\r\n7hsd8+wlIvoJ4lxFtslbi1hkk6ZshYmeXD8WI2zJXRqRJY/SUL+Y7F+oaY8bYRkq\r\nRU7as+kHD3Mbs714WtQ9uQCXrlD8zVH9dUgJaf//aKu4GIzHEQDNy34CEmLGhO37\r\nTBDaR+WIt+iSfQMPznRUQ0YtNlGP6ZPK0JVoe5Ow1JvZ3zgw8ndOS/KOsyn//CCh\r\naQIDAQAB\r\n-----END PUBLIC KEY-----\r\n",
    }
};

async function main() {
    const wss = new WebSocket.Server({ port: 5555 });
    wss.on('connection', handler);
    console.log("WebSocket server started on port 5555");
    await cts("s6");
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function UserList() {
    const clientList = Array.from(LocalC.values());
    const message = JSON.stringify({
        tag: 'presence',
        presence: clientList.map(username => ({
            nickname: username.split('@')[0],
            jid: username,
            publickey: keys[username]?.publicKey,
            domain: DNAME
        }))
    });
    for (const [client, username] of LocalC.entries()) {
        try {
            client.send(message);
        } catch (e) {
            LocalC.delete(client);
            console.log(`Client ${username} disconnected. Total clients: ${LocalC.size}`);
            await UpdateClients();
        }
    }

    for (const [domain, connection] of Object.entries(CstoS)) {
        try {
            connection.send(message);
            console.log(`Sent presence message to ${domain}: ${message}`);
        } catch (e) {
            console.log(`Failed to send presence message to ${domain}: ${e}`);
            await cts(domain);
        }
    }
}

async function LocalBroadcast(message, senderUsername) {
    for (const [client, username] of LocalC.entries()) {
        if (username !== senderUsername) {
            try {
                client.send(message);
            } catch (e) {
                LocalC.delete(client);
                console.log(`Client ${username} disconnected. Total clients: ${LocalC.size}`);
                await UpdateClients();
            }
        }
    }
}

async function UniversalBroadcast(message, senderUsername) {
    for (const [client, username] of LocalC.entries()) {
        if (username !== senderUsername) {
            try {
                client.send(message);
            } catch (e) {
                LocalC.delete(client);
                console.log(`Client ${username} disconnected. Total clients: ${LocalC.size}`);
                await UpdateClients();
            }
        }
    }

    const senderDomain = senderUsername.split('@').pop();
    if (senderDomain === DNAME) {
        for (const [domain, connection] of Object.entries(CstoS)) {
            if (domain !== DNAME) {
                try {
                    connection.send(message);
                } catch (e) {
                    await cts(domain);
                }
            }
        }
    }
}

async function cts(domain) {
    const uri = serverMapping[domain];
    while (true) {
        try {
            const connection = new WebSocket(uri);
            connection.on('open', async () => {
                CstoS[domain] = connection;
                console.log(`Connected to ${domain} server at ${uri}`);
                await UserList();
            });
            connection.on('close', async () => {
                console.log(`Connection to ${domain} server closed. Retrying in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                await cts(domain);
            });
            connection.on('error', (error) => {
                console.error(`Connection error to ${domain} server: ${error.message}`);
            });
            break;
        } catch (e) {
            console.log(`Failed to connect to ${domain} server: ${e}. Retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function UpdateClients() {
    const message = JSON.stringify({
        tag: 'fr_list',
        content: Users
    });
    await LocalBroadcast(message, null);
    for (const [domain, connection] of Object.entries(CstoS)) {
        try {
            connection.send(message);
        } catch (e) {
            await cts(domain);
        }
    }
}

async function TextPvt(message, senderUsername, targetUsername, targetDomain) {
    if (targetDomain === DNAME) {
        const targetClient = Array.from(LocalC.entries()).find(([client, username]) => username === targetUsername);
        if (targetClient) {
            try {
                targetClient[0].send(message);
            } catch (e) {
                LocalC.delete(targetClient[0]);
                console.log(`Client ${targetUsername} disconnected. Total clients: ${LocalC.size}`);
                await UpdateClients();
            }
        }
    } else {
        if (CstoS[targetDomain]) {
            try {
                CstoS[targetDomain].send(message);
            } catch (e) {
                await cts(targetDomain);
            }
        }
    }
}

async function handler(ws) {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.tag) {
                if (data.tag === 'login' && data.username && data.password) {
                    const username = data.username;
                    const password = data.password;
                    const userDomain = username.split('@').pop();
                    if (registeredUsers[username] && hashPassword(password) === registeredUsers[username]) {
                        LocalC.set(ws, username);
                        if (!Users[username]) {
                            Users[username] = { status: 'online', domain: userDomain };
                            await UpdateClients();
                            console.log(`User ${username} connected from ${ws._socket.remoteAddress}.`);
                            const statusMessage = JSON.stringify({ tag: 'status', content: `${username} joined the chat` });
                            await LocalBroadcast(statusMessage, username);
                            await UserList();
                        }
                    } else {
                        const errorMessage = JSON.stringify({ tag: 'error', content: "Invalid username or password" });
                        ws.send(errorMessage);
                    }
                } else if (data.tag === 'message' && data.info && data.to) {
                    const senderUsername = data.from;
                    const targetUsername = data.to;
                    const targetDomain = targetUsername.split('@').pop();
                    const userDomain = senderUsername.split('@').pop();
                    if (targetUsername === 'public') {
                        console.log(`Received broadcast message from ${senderUsername}: ${data.info}`);
                        const broadcastMessage = JSON.stringify({
                            tag: 'message',
                            info: data.info,
                            from: senderUsername,
                            to: 'public'
                        });
                        if (userDomain === DNAME) {
                            await UniversalBroadcast(broadcastMessage, senderUsername);
                        } else {
                            await LocalBroadcast(broadcastMessage, senderUsername);
                        }
                    } else {
                        console.log(`Received private message from ${senderUsername} to ${targetUsername}: ${data.info}`);
                        const privateMessage = JSON.stringify({
                            tag: 'message',
                            info: data.info,
                            from: senderUsername,
                            to: targetUsername
                        });
                        await TextPvt(privateMessage, senderUsername, targetUsername, targetDomain);
                    }
                } else if (data.tag === 'file' && data.info && data.filename && data.to) {
                    const senderUsername = data.from;
                    const targetUsername = data.to;
                    const targetDomain = targetUsername.split('@').pop();
                    const userDomain = senderUsername.split('@').pop();
                    const fileMessage = JSON.stringify({
                        tag: 'file',
                        info: data.info,
                        filename: data.filename,
                        from: senderUsername,
                        to: targetUsername
                    });
                    if (targetDomain === DNAME) {
                        if (targetUsername === 'public') {
                            await LocalBroadcast(fileMessage, senderUsername);
                        } else {
                            await TextPvt(fileMessage, senderUsername, targetUsername, targetDomain);
                        }
                    } else {
                        CstoS[targetDomain].send(fileMessage);
                    }
                } else if (data.tag === 'presence' && data.presence) {
                    for (const clientInfo of data.presence) {
                        const jid = clientInfo.jid;
                        GlobalC[jid] = clientInfo;
                        // Update presence information in Users
                        Users[jid] = { status: 'online', domain: clientInfo.domain || 'unknown', publicKey: clientInfo.publicKey };
                        }
                        await UpdateClients();
                        console.log(`Updated external clients: ${JSON.stringify(GlobalC)}`);

                } else if (data.tag === 'buffer' && data.data) {
                    fs.appendFile('buffer.txt', data.data, (err) => {
                        if (err) {
                            console.error('Failed to write buffer:', err);
                        }});
                } else {
                    console.log("Invalid message format: missing 'tag' field");
                    const errorMessage = JSON.stringify({ tag: 'error', content: "Invalid message format: missing 'tag' field" });
                    ws.send(errorMessage);
                }
            }
        } catch (e) {
            console.log("Invalid JSON received");
            const errorMessage = JSON.stringify({ tag: 'error', content: "Invalid JSON format." });
            ws.send(errorMessage);
        }
    });

    ws.on('close', async () => {
        if (LocalC.has(ws)) {
            const username = LocalC.get(ws);
            LocalC.delete(ws);
            if (Users[username]) {
                delete Users[username];
                console.log(`Client ${username} disconnected. Total clients: ${LocalC.size}`);
                const statusMessage = JSON.stringify({ tag: 'status', content: `${username} left the chat` });
                await LocalBroadcast(statusMessage, username);
                await UpdateClients();
                for (const [domain, connection] of Object.entries(CstoS)) {
                    try {
                        connection.send(JSON.stringify({
                            tag: 'logout',
                            username: username
                        }));
                    } catch (e) {
                        await cts(domain);
                    }
                }
            }
        }
    });
}

main();