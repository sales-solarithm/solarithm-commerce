import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const qs = await getDocs(query(collection(db, 'pricingRules'), limit(5)));
  qs.forEach(doc => console.log(doc.id, doc.data()));
  process.exit(0);
}
main();
