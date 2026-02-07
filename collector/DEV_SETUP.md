# Local Development Environment (Hot Reload)

To use hot reload for the frontend, follow these steps:

1. **Stop the Docker container** (to free up the port):
   ```bash
   docker compose stop index
   ```

2. **Run the development environment**:
   ```bash
   cd index
   npm run dev
   ```
   This will start both the backend (with watch mode) and the frontend (with Vite HMR).

3. **Access the Dashboard**:
   Open `http://localhost:5173/ui/` in your browser.

## Configuration
The `dev` script uses `dev.env` for local connections. Ensure your Redis and ChromaDB containers are running.
