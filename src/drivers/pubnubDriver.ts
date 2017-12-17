import Pubnub = require("pubnub");
import Stream from "xstream";

export const makePubnubDriver = () => (): PubnubSource => {
    const subscribeKey = "sub-c-52a9ab50-291b-11e5-baaa-0619f8945a4f";
    return new PubnubSource(new Pubnub({ subscribeKey }));
};

export class PubnubSource {
    public boardSnapshot$ = Stream.create();
    public board$ = Stream.create();
    public ticker$ = Stream.create();
    public execution$ = Stream.create();

    private client: Pubnub;

    constructor(client: Pubnub) {
        this.client = client;

        client.addListener({
            message: (message) => {
                if (message.channel === "lightning_board_snapshot_FX_BTC_JPY") {
                    this.boardSnapshot$.shamefullySendNext(message.message);
                } else if (message.channel === "lightning_board_FX_BTC_JPY") {
                    this.board$.shamefullySendNext(message.message);
                } else if (message.channel === "lightning_ticker_FX_BTC_JPY") {
                    this.ticker$.shamefullySendNext(message.message);
                } else if (message.channel === "lightning_executions_FX_BTC_JPY") {
                    message.message.forEach(message => this.execution$.shamefullySendNext(message));
                }
            },
            presence: (presence) => undefined,
            status: (status) => undefined
        });

        client.subscribe({
            channels: [
                "lightning_board_snapshot_FX_BTC_JPY",
                "lightning_board_FX_BTC_JPY",
                "lightning_executions_FX_BTC_JPY"
            ]
        })
    }
}
