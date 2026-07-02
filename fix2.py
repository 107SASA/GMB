import re

path = 'src/services/inngest/functions.ts'

with open(path, 'r') as f:
    content = f.read()

# Fix event triggers
content = re.sub(
    r'event:\s*("[^"]+")',
    r'triggers: [{ event: \1 }]',
    content
)

# Fix cron triggers
content = re.sub(
    r'cron:\s*("[^"]+")',
    r'triggers: [{ cron: \1 }]',
    content
)

with open(path, 'w') as f:
    f.write(content)

print("V4 Syntax Replacement complete.")
