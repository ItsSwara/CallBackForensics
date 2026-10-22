# Eval results

Appended by `npm run eval -- --ai-url http://localhost:8080 --label <1b|3b|...>`. One block per run, newest last.

No real-model runs are recorded yet.

## 3b · 2026-10-22 10:31 · model: C:\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf · server: http://localhost:8080

| scenario | rule-based | AI pass/fail | seconds |
|---|---|---|---|
| hubspot-phone | PASS | PASS | 5.4 |
| github-pr | PASS | PASS | 2.5 |
| stripe-customer | PASS | PASS | 2.6 |
| hubspot-email | PASS | PASS | 2.6 |
| order-items | PASS | PASS | 2.5 |
| oauth-redirect | PASS | FAIL | 3.9 |

Rule-based: 6/6 · AI: 5/6

Pass means the output mentions every keyword group in each scenario's truth.json (fixed in advance). Rule-based scoring uses the diff findings plus the parsed error line. Failures are reported as they happened.

<details><summary>hubspot-phone</summary>

```
ROOT CAUSE: The failing code expects the `phone_number` property to be an integer, but the latest payload contains a string instead.
FIX: Update the failing code to handle the `phone_number` property as a string, for example by using a try-catch block to convert the string to an integer.
```

</details>
<details><summary>github-pr</summary>

```
ROOT CAUSE: The error occurs because the 'pull_request' key is missing from the current payload, causing 'payload.pull_request' to be undefined, and subsequently, 'payload.pull_request.user' to be undefined.
FIX: Add a check to ensure 'pull_request' exists in the payload before trying to access its 'user' property.
```

</details>
<details><summary>stripe-customer</summary>

```
ROOT CAUSE: The error occurs because the `customer` property in the Stripe event payload is now null, causing the code to fail when trying to access the `email` property of the `customer` object.

FIX: Update the code to handle the case where `customer` is null, for example by checking if it exists before trying to access its `email` property.
```

</details>
<details><summary>hubspot-email</summary>

```
ROOT CAUSE: The error occurs because the 'email' property is missing from the current payload, causing the 'contact' object to be undefined, and subsequently, the 'toLowerCase' method is called on undefined, resulting in the TypeError.

FIX: Add a check to ensure the 'email' property exists in the payload before attempting to access it.
```

</details>
<details><summary>order-items</summary>

```
ROOT CAUSE: The failing code is trying to access the 'price' property of the first item in the 'items' array, but the 'items' array is now empty, causing the error.
FIX: Add a check to ensure the 'items' array is not empty before trying to access its elements.
```

</details>
<details><summary>oauth-redirect</summary>

```
ROOT CAUSE: The error occurs because the `state` parameter is missing from the request, causing the `pending` variable to be undefined, and subsequently, the `verifier` property of `pending` is also undefined, leading to a TypeError when trying to access `verifier` on an undefined value.

FIX: Add the `state` parameter to the query string in the request, so that the `pending` variable is not undefined.
```

</details>
