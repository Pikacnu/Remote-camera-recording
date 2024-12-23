import { $ } from 'bun';

Bun.serve({
	async fetch(req, server) {
		const url = new URL(req.url);

		if (server.upgrade(req)) {
			return;
		}
		if (url.pathname.startsWith('/stream/readable')) {
			const reader = req.body?.getReader();
			const time = new Date().getTime();
			if (!reader) {
				return new Response('No reader', { status: 400 });
			}
			const fileStream = Bun.file(`./saves/${time}-video.webm`).writer();
			const readerData = await reader.read();
			fileStream.write(readerData.value?.buffer as ArrayBuffer);
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				fileStream.write(value?.buffer as ArrayBuffer);
			}
			await $`ffmpeg -i ./saves/${time}-video.webm -c:v libx264 -c:a aac ./saves/${time}-video.mp4`;
			return new Response('OK');
		}
		if (url.pathname.startsWith('/stream')) {
			return new Response(Bun.file('./src/test.html'));
		}
		return new Response(Bun.file('./src/index.html'));
	},
	idleTimeout: 1000,
	port: 8080,
	reusePort: true,
	websocket: {
		open(ws) {
			console.log('WebSocket opened');
			ws.subscribe('offer');
			ws.subscribe('answer');
			ws.subscribe('ice-candidate');
		},
		async message(ws, msg) {
			const data = JSON.parse(msg.toString());
			switch (data.type) {
				case 'get-turn':
					const res = await fetch(
						`https://rtc.live.cloudflare.com/v1/turn/keys/3abafda6e090abb364141ceb38225f43/credentials/generate`,
						{
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${process.env.TURN_TOKEN}`,
							},
							body: JSON.stringify({
								ttl: 86400,
							}),
						},
					);
					const json = await res.json();
					ws.send(
						JSON.stringify({
							type: 'turn',
							iceServers: Object.assign(json.iceServers, {
								iceTransportPolicy: 'relay',
							}),
						}),
					);
					break;
				case 'offer':
					ws.publish('offer', JSON.stringify(data));
					break;
				case 'answer':
					ws.publish('answer', JSON.stringify(data));
					break;
				case 'ice-candidate':
					console.log('ice-candidate', data);
					ws.publish('ice-candidate', JSON.stringify(data));
					break;
				default:
					console.log('Unknown message type:', data.type);
			}
		},
		close(_ws, code, reason) {
			console.log('WebSocket closed:', code, reason);
		},
		drain(_ws) {
			console.log('WebSocket drained');
		},
	},
});

console.log('Server started');
