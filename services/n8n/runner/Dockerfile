FROM n8nio/runners:latest

USER root

# Attempt to install uv directly using pip (assuming python/pip are present)
RUN pip install uv --break-system-packages --no-cache-dir

# Install python dependencies for the runner
RUN mkdir -p /opt/runners/task-runner-python

# Install packages using uv into the system python or specific venv
RUN cd /opt/runners/task-runner-python && \
    uv pip install --upgrade telegramify-markdown "telegramify-markdown[mermaid]" --python /opt/runners/task-runner-python/.venv/bin/python

# Patch the default config to allow all imports (overriding the default restrictive settings)
# We use python to modify the JSON in place, preserving optimal paths/commands
RUN python3 -c "import json; \
    f='/etc/n8n-task-runners.json'; \
    data=json.load(open(f)); \
    [r['env-overrides'].update({'N8N_RUNNERS_STDLIB_ALLOW':'*', 'N8N_RUNNERS_EXTERNAL_ALLOW':'*'}) for r in data['task-runners'] if r['runner-type']=='python']; \
    [r['env-overrides'].update({'NODE_FUNCTION_ALLOW_BUILTIN':'*', 'NODE_FUNCTION_ALLOW_EXTERNAL':'*', 'NODE_PATH':'/usr/lib/node_modules:/opt/runners/task-runner-javascript/node_modules'}) for r in data['task-runners'] if r['runner-type']=='javascript']; \
    json.dump(data, open(f,'w'))"

# Restore apk tools (pattern from root Dockerfile)
RUN ARCH=$(uname -m) && \
    wget -qO- "http://dl-cdn.alpinelinux.org/alpine/latest-stable/main/${ARCH}/" | \
    grep -o 'href="apk-tools-static-[^"]*\.apk"' | head -1 | cut -d'"' -f2 | \
    xargs -I {} wget -q "http://dl-cdn.alpinelinux.org/alpine/latest-stable/main/${ARCH}/{}" && \
    tar -xzf apk-tools-static-*.apk && \
    ./sbin/apk.static -X http://dl-cdn.alpinelinux.org/alpine/latest-stable/main -U --allow-untrusted add apk-tools && \
    rm -rf sbin apk-tools-static-*.apk

# Install nodejs, npm and pnpm
RUN cd /opt/runners/task-runner-javascript && \
    pnpm add cron-parser

# Set NODE_PATH to include global and local modules
ENV NODE_PATH=/usr/lib/node_modules:/usr/local/lib/node_modules:/opt/runners/task-runner-javascript/node_modules

USER runner
