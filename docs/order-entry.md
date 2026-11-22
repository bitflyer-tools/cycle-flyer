# Order form reference

The order form on **Trade** submits orders for `FX_BTC_JPY`. Submitting an
order requires bitFlyer Lightning API credentials with order permissions.
Set **Size** in BTC before choosing **Buy** or **Sell** in the order section.
For **Stop** and **Ranged IFDOCO**, the current price comes from the most
recent valid trade price received by the app.

| Section | Fields and validation |
| --- | --- |
| **Market** | Size must be at least 0.01 BTC. |
| **Limit** | Size and limit price must both be positive. |
| **Stop** | Size and trigger price must both be positive. A buy trigger must be above the current price, and a sell trigger must be below it. |
| **Ranged IFDOCO** | Size and **Price width** must be positive. **Profit / Loss Ratio** must be numeric and is clamped to 0–100. Both calculated exit prices must be positive. |
| **TWAP** | **Slices** must be a positive whole number. **Interval (sec)** must be greater than 0 and at most 2,147,483.647 seconds. Every slice must be at least 0.01 BTC. |

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
also stops the schedule. Orders already sent to bitFlyer can still execute.
