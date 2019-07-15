import * as SocketIOClient from "socket.io-client";
import Stream from "xstream";

export const makeSocketIODriver = () => (): SocketIOSource => {
    const serverURL = "https://io.lightstream.bitflyer.com";
    const options = { transports: ["websocket"] };
    return new SocketIOSource(SocketIOClient(serverURL, options));
};

export class SocketIOSource {
    public boardSnapshot$: Stream<object> = Stream.create();
    public board$: Stream<object> = Stream.create();
    public ticker$: Stream<object> = Stream.create();
    public execution$: Stream<object> = Stream.create();

    private channelNames = [
        "lightning_board_snapshot_FX_BTC_JPY",
        "lightning_board_FX_BTC_JPY",
        "lightning_executions_FX_BTC_JPY",
    ];

    constructor(client: SocketIOClient.Socket) {
        client.on("connect", () => {
            this.channelNames.forEach((channelName) => client.emit("subscribe", channelName));
        });

        this.channelNames.forEach((channelName) => {
            client.on(channelName, (message: any) => {
                if (channelName === "lightning_board_snapshot_FX_BTC_JPY") {
                    this.boardSnapshot$.shamefullySendNext(message);
                } else if (channelName === "lightning_board_FX_BTC_JPY") {
                    this.board$.shamefullySendNext(message);
                } else if (channelName === "lightning_ticker_FX_BTC_JPY") {
                    this.ticker$.shamefullySendNext(message);
                } else if (channelName === "lightning_executions_FX_BTC_JPY") {
                    message.forEach((m: any) => this.execution$.shamefullySendNext(m));
                }
            });
        });
    }
}
