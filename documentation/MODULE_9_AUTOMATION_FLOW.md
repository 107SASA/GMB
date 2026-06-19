# Module 9: Automation Flow

## Drip Campaign Sequence (`campaigns/review.request.start`)

When an admin clicks "Request" in the UI, the Inngest worker takes over.

1. **Validation**: Check if the customer exists and `optedOut === false`.
2. **AI Generation**: Query Groq's LLaMA 3.3 model to generate a custom 2-sentence WhatsApp message that references the specific `service` the customer purchased (making it feel highly personal rather than automated).
3. **Database Setup**: Generate a `ReviewRequest` log to track clicks.
4. **Step 1 (Immediate)**: Send the initial AI message via Twilio.
5. **Wait State**: Inngest puts the thread to sleep for exactly 48 hours.
6. **Check State**: Did the user click the link? Did they reply "STOP"? If no:
7. **Step 2 (Reminder)**: Send Reminder 1.
8. **Wait State**: Inngest puts the thread to sleep for 5 days.
9. **Check State**: Did they click/opt-out? If no:
10. **Step 3 (Final)**: Send Final Reminder and mark the automation as 'Completed'.

## Opt-Out Flow (Compliance)
If a user replies "STOP", "UNSUBSCRIBE", or "CANCEL" via WhatsApp at *any* time, the `POST /api/whatsapp/webhook` intercepts it before triggering any AI logic. 
It immediately updates `Customer.optedOut = true`.
Because the Inngest drip campaign performs a state-check before every single outbound message, it will safely abort the next time it wakes up, ensuring zero spam violations.
