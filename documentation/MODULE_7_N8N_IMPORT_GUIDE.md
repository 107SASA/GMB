# Module 7: n8n Import Guide

## How to Import the Workflows

The `n8n-workflows` directory in the root of the project contains 3 JSON files.

1. Open your n8n dashboard (`http://localhost:5678`).
2. Click **Workflows** in the left sidebar.
3. Click **Add Workflow** (top right).
4. In the empty canvas, click the **... (Options)** menu in the top right corner.
5. Select **Import from File**.
6. Select `workflow-1-buffer-monitor.json` from the `n8n-workflows` folder.
7. The nodes will instantly populate the canvas!

## Configuring Credentials
After importing, you will see some nodes with warnings (red exclamation marks) regarding missing credentials.

1. Double-click the **Check Buffer** node (or any HTTP Request hitting the GMB API).
2. Under Authentication, select **Generic Credential Type** -> **Header Auth**.
3. Create a new credential named `GMB API Key`.
4. Set the Name to `x-api-key` and Value to your secure API key.

## Connecting Twilio
1. Double-click the **Send Twilio Alert** node.
2. Under Authentication, select **Basic Auth**.
3. Create a new credential.
4. Set User to your `TWILIO_ACCOUNT_SID`.
5. Set Password to your `TWILIO_AUTH_TOKEN`.

## Activating
Once credentials and environment variables (see Env Setup Guide) are configured, toggle the switch in the top right of the workflow canvas from **Inactive** to **Active**.
