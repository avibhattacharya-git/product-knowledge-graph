# Instructions for Claude Code (macOS Standup & Verification)

You are assisting the developer in standing up the **US Retailer Product Knowledge Graph** application on their macOS work laptop. The files and database dumps have been packaged and migrated. Your goal is to restore the databases, update environment variables, install dependencies, and launch the server.

---

## 📖 Available Documentation
* **`MAC_MIGRATION_GUIDE.md`**: Detailed step-by-step setup instructions for databases and environment keys.
* **`ARCHITECTURE.md`**: High-level and detailed architecture overview of the backend, DB, ETL, and frontend systems.
* **`ARCHITECTURE_DIAGRAM.svg`**: High-fidelity visual diagram of the system data flow and Stage A-G ETL pipeline.
* **`FEATURES_DIAGRAM.svg`**: Detailed request pipeline flow mapping routes to classes, services, and repositories.

---

## 🛠️ Step-by-Step Execution Plan

Please execute the following tasks to stand up the application:

### 1. Update `docker-compose.yml` for macOS
* Modify the `neo4j` and `neo4j-mock` services to use `neo4j:5.18.0-enterprise`.
* Add `NEO4J_ACCEPT_LICENSE_AGREEMENT=yes` to the environment variables of both Neo4j services.

### 2. Verify & Start Docker/Colima
* Check if Docker is running. If not, use Colima to spin up the Docker daemon:
  ```bash
  colima start --cpu 4 --memory 8
  ```

### 3. Restore the Neo4j Database
* Stop the Neo4j container to release file locks on mounts:
  ```bash
  docker-compose stop neo4j
  ```
* Run the offline database restore using a temporary docker container mounting the local host directories:
  ```bash
  docker run --rm \
    -v "$(pwd)/neo4j/data:/data" \
    -v "$(pwd)/neo4j/import:/import" \
    neo4j:5.18.0-enterprise \
    neo4j-admin database load neo4j --from-path=/import --overwrite-destination=true
  ```
* Start the Neo4j container back up:
  ```bash
  docker-compose up -d neo4j
  ```

### 4. Restore PostgreSQL Caching Tables
* Load the cache dump into the active PostgreSQL Docker container `product-data-postgres` (database `ProductDataProd`):
  ```bash
  docker exec -i product-data-postgres psql -U postgres -d ProductDataProd < datadump/caching_tables.sql
  ```

### 5. Update the `.env` Configuration
* Modify the existing `.env` file in the root directory:
  * Set `PG_DATABASE=ProductDataProd`.
* Query AWS Secrets Manager to fetch the Gemini API Key and append it to `.env`:
  ```bash
  # Replicate the secret retrieval region/SecretId logic from the local 'product-data-search' codebase.
  # Example fetch using AWS CLI (adjust secret name/ARN and JSON key accordingly):
  aws secretsmanager get-secret-value --secret-id <YOUR_SECRET_ID_OR_ARN> --query SecretString --output text | jq -r '.GEMINI_API_KEY' | xargs -I {} echo "GEMINI_API_KEY={}" >> .env
  ```

### 6. Install & Start Application
* Install the NPM dependencies:
  ```bash
  bun install
  ```
* Launch the API and visual client server:
  ```bash
  bun start
  ```

### 7. Run Verification Tests
* Run the test suite to ensure the system is fully functional:
  * Backend Service & Recommendation Tests: `bun test tests/backend`
  * E2E UI Tests (Puppeteer): `bun tests/ux/e2e-ui-test.ts`
