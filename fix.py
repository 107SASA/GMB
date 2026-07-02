import re

path = 'src/services/inngest/functions.ts'

with open(path, 'r') as f:
    content = f.read()

new_content = re.sub(
    r'inngest\.createFunction\(\s*\{\s*([^}]+?)\s*\},\s*\{\s*([^}]+?)\s*\},',
    r'inngest.createFunction(\n  { \1, \2 },',
    content
)

with open(path, 'w') as f:
    f.write(new_content)

print("Replacement complete.")
