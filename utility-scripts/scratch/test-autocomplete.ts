const q = 'Active Odor';
const url = `http://localhost:3000/api/autocomplete?q=${encodeURIComponent(q)}`;

async function test() {
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Autocomplete suggestions for "${q}":`, JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}
test();
