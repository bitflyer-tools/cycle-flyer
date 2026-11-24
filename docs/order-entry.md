# Order form reference

The order form on **Trade** submits orders for `FX_BTC_JPY`. Submitting an
order requires bitFlyer Lightning API credentials with order permissions.
Set **Size** in BTC-CFD before choosing **Buy** or **Sell** in the order section.
The [bitFlyer minimum order size](https://bitflyer.com/ja-jp/faq/trade_bitcoin)
is 0.001 BTC-CFD.
For **Stop** and **Ranged IFDOCO**, the current price comes from the most
recent valid trade price received by the app.

| Section | Fields and validation |
| --- | --- |
| **Market** | Size must be at least 0.001 BTC-CFD. |
| **Limit** | Size must be at least 0.001 BTC-CFD and the limit price must be positive. |
| **Stop** | Size must be at least 0.001 BTC-CFD and the trigger price must be positive. A buy trigger must be above the current price, and a sell trigger must be below it. |
| **Ranged IFDOCO** | Size must be at least 0.001 BTC-CFD and **Price width** must be positive. **Profit / Loss Ratio** must be numeric and is clamped to 0–100. Both calculated exit prices must be positive. |
| **TWAP** | **Slices** must be a positive whole number. **Interval (sec)** must be greater than 0 and at most 2,147,483.647 seconds. Every slice must be at least 0.001 BTC-CFD. |
| **Clear Position** | The position's absolute size must be at least 0.001 BTC-CFD. A remainder below that minimum cannot be cleared; [bitFlyer requires it to reach the minimum first](https://bitflyer.com/en-jp/faq/4-25). |

## Ranged IFDOCO

The app submits a market entry with two opposite-side exits, a limit order
for profit and a stop order for loss. It calculates exit prices from the
current price when you submit the order. The profit offset is **Price width**
multiplied by the ratio as a percentage. The loss offset is the rest of the
width. For a buy entry, the profit price is above or at the current price and
the loss trigger is below or at it. For a sell entry, the directions reverse.

## TWAP

**Size** is the total amount to split. The first market slice is scheduled
immediately, and subsequent slices are scheduled at the configured interval.
Edits to the schedule apply to the next run.

**Cancel TWAP** stops future slices. Leaving **Trade** or changing credentials
also stops the schedule. If an order request cannot be signed, TWAP stops
sending the remaining slices, so only some of the planned orders may have been
sent. Orders already sent to bitFlyer can still execute.
