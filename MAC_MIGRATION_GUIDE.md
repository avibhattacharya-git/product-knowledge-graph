# macOS Migration Guide

This guide provides step-by-step instructions to transfer, set up, and run the **US Retailer Product Knowledge Graph** application on your macOS work laptop.

---

## 📋 Overview of Setup on macOS

Your macOS setup will consist of:
1. **Application Runtime**: Running directly on the host using **Bun** (no Docker container for the app).
2. **Databases**:
   - **PostgreSQL**: Running in a Docker container (pre-existing, with your product data).
   - **Neo4j Enterprise Edition**: Running in a Docker container (to be installed).
3. **LLM Integration**: Dynamically loading the Gemini API key from AWS Secrets Manager.

---

## 🛠️ Prerequisites on macOS

Ensure you have the following installed and configured on your Mac:
* **Docker & Colima**: Start Colima before running Docker commands:
  ```bash
  colima start --cpu 4 --memory 8
  ```
* **Bun**: The modern Javascript runtime. If not installed, run:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
* **AWS CLI**: Configured with credentials to access AWS Secrets Manager:
  ```bash
  aws configure
  ```

---

## ⚡ Step-by-Step Migration Instructions

### Step 1: Extract the Packages on macOS
1. Transfer `knowledgegraph_app.zip` and `neo4j_dump.zip` to your Mac.
2. Unzip the codebase:
   ```bash
   unzip knowledgegraph_app.zip -d product-knowledge-graph
   cd product-knowledge-graph
   ```
3. Move or extract `neo4j.dump` (from `neo4j_dump.zip`) into the `./neo4j/import` folder of the unzipped application:
   ```bash
   # Create folders if they don't exist
   mkdir -p neo4j/import neo4j/data neo4j/logs neo4j/plugins
   
   # Copy or move the neo4j.dump file here
   unzip /path/to/neo4j_dump.zip -d neo4j/import/
   ```

---

### Step 2: Configure Neo4j Enterprise in Docker
To run **Neo4j Enterprise Edition** in Docker, you must accept the license agreement by setting `NEO4J_ACCEPT_LICENSE_AGREEMENT=yes`.

1. Open the `docker-compose.yml` file in the codebase.
2. Update the `neo4j` and `neo4j-mock` services to use the **Enterprise** image and accept the license.

Here is the recommended configuration:

```yaml
version: '3.8'

services:
  neo4j:
    image: neo4j:5.18.0-enterprise
    container_name: product-data-neo4j
    ports:
      - "7474:7474" # HTTP Browser Console
      - "7687:7687" # Bolt binary driver protocol
    environment:
      - NEO4J_AUTH=neo4j/retailpassword123
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_ACCEPT_LICENSE_AGREEMENT=yes # Required for Enterprise Edition
      - NEO4J_server_memory_heap_initial__size=4G
      - NEO4J_server_memory_heap_max__size=8G
      - NEO4J_server_memory_pagecache_size=4G
    volumes:
      - ./neo4j/data:/data
      - ./neo4j/logs:/logs
      - ./neo4j/import:/var/lib/neo4j/import
      - ./neo4j/plugins:/plugins
    restart: always

  neo4j-mock:
    image: neo4j:5.18.0-enterprise
    container_name: product-data-neo4j-mock
    ports:
      - "7475:7474" # HTTP Browser Console for Mock
      - "7688:7687" # Bolt binary driver protocol for Mock
    environment:
      - NEO4J_AUTH=neo4j/retailpassword123
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_ACCEPT_LICENSE_AGREEMENT=yes # Required for Enterprise Edition
      - NEO4J_server_memory_heap_initial__size=1G
      - NEO4J_server_memory_heap_max__size=2G
      - NEO4J_server_memory_pagecache_size=1G
    restart: always

  # Your existing postgres container...
```

> [!IMPORTANT]
> Because the dump was created on **Neo4j 5.18.0 (Community)**, your target database must be **version >= 5.18.0**. Using `neo4j:5.18.0-enterprise` is highly recommended for compatibility.

---

### Step 3: Import the Neo4j Database Dump
Since Neo4j is running in Docker and the import directory is mapped to the host, you can perform an offline restore using a temporary docker container. This avoids file-locking issues.

1. Ensure the main Neo4j container is **stopped** (to release database locks on the volumes):
   ```bash
   docker-compose stop neo4j
   ```
2. Run the restore command using a temporary container:
   ```bash
   docker run --rm \
     -v "$(pwd)/neo4j/data:/data" \
     -v "$(pwd)/neo4j/import:/import" \
     neo4j:5.18.0-enterprise \
     neo4j-admin database load neo4j --from-path=/import --overwrite-destination=true
   ```
3. Start the Neo4j container:
   ```bash
   docker-compose up -d neo4j
   ```

---

### Step 4: Import PostgreSQL Caching Tables
Your Mac already has the primary PostgreSQL data, but it lacks the caching and judgment tables. We exported these tables to `./datadump/caching_tables.sql`.

Import them into your running PostgreSQL container (assuming the container name is `product-data-postgres` and the database name is `ProductDataProd`):

```bash
docker exec -i product-data-postgres psql -U postgres -d ProductDataProd < datadump/caching_tables.sql
```

This will cleanly recreate and populate:
* `category_relationships_cache` (LLM-evaluated category overlaps)
* `brand_competitor_judgments` (LLM-evaluated brand overlaps)
* `query_embedding_cache` (NLQ embedding cache)

---

### Step 5: Configure Environment & LLM Secrets
The `.env` file from your Windows development environment has been transferred inside the ZIP package. You (or your Claude Code agent) must update this file on your Mac to align with the macOS Docker database settings and LLM secrets.

#### Method A: Populate `.env` from AWS Secrets (Recommended & Zero Code Changes)
To use your AWS Secrets Manager to populate your Gemini credentials:

1. Open the existing `.env` file in the root of the project.
2. Update the PostgreSQL database name to match your Mac:
   ```env
   PG_DATABASE=ProductDataProd
   ```
   *(Also review and adjust `PG_HOST`, `PG_PORT`, `NEO4J_URI`, etc., if they differ on your Mac Docker environment).*
3. Run the following command to retrieve your Gemini API key from AWS Secrets Manager and append it to `.env`:
   ```bash
   # If stored as a JSON object (e.g. key is 'GEMINI_API_KEY'):
   aws secretsmanager get-secret-value --secret-id <YOUR_SECRET_ID_OR_ARN> --query SecretString --output text | jq -r '.GEMINI_API_KEY' | xargs -I {} echo "GEMINI_API_KEY={}" >> .env

   # If stored as a plain string:
   GEMINI_KEY=$(aws secretsmanager get-secret-value --secret-id <YOUR_SECRET_ID_OR_ARN> --query SecretString --output text)
   echo "GEMINI_API_KEY=$GEMINI_KEY" >> .env
   ```

#### Method B: Programmatic Fetch in App Start (Replicate from `product-data-search`)
If you want the application to load the key dynamically at startup from AWS, you can replicate the exact programmatic lookup pattern already implemented in your `product-data-search` codebase on macOS:

1. Install the AWS SDK Secrets Manager client:
   ```bash
   bun add @aws-sdk/client-secrets-manager
   ```
2. Open your `product-data-search` codebase on macOS and copy the secret-retrieval helper function (which contains the correct AWS Region and Secret ID/ARN).
3. Integrate this function into `configs/app.config.ts` or a new utility file (e.g., `utility-scripts/secrets-helper.ts`) to fetch the key and set it:
   ```typescript
   import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

   // Adapt this skeleton using the exact SecretId/ARN and parsing keys from product-data-search:
   async function fetchGeminiKeyFromAws(secretId: string): Promise<string> {
     const client = new SecretsManagerClient({ region: "us-east-1" }); // check region in product-data-search
     const command = new GetSecretValueCommand({ SecretId: secretId }); // check SecretId in product-data-search
     const response = await client.send(command);
     
     if (!response.SecretString) {
       throw new Error("SecretString is empty");
     }
     
     try {
       const parsed = JSON.parse(response.SecretString);
       // Parse using the same key name as product-data-search (e.g., GEMINI_API_KEY)
       return parsed.GEMINI_API_KEY || response.SecretString;
     } catch {
       return response.SecretString;
     }
   }
   ```
4. Await this function at server startup to dynamically warm up `appConfig.geminiApiKey`.

---

### Step 6: Install and Start the App
Now that your databases and API credentials are ready, launch the server:

1. Install project dependencies:
   ```bash
   bun install
   ```
2. Start the Hono server:
   ```bash
   bun start
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

Your visual client is up, running, and fully connected to your Mac Docker Neo4j and Postgres instances!
