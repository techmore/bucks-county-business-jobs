const fs = require("fs");

const CENTER = { latitude: 40.4825, longitude: -75.1069 };
const PEDDLERS = { latitude: 40.3479, longitude: -75.0321 };
const PEDDLERS_ADDRESS = "Routes 202 & 263, Lahaska, PA 18931";
const PEDDLERS_SOURCE = "https://peddlersvillage.com/wp-content/uploads/2025/03/PV-Map0325.pdf";

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function company(overrides) {
  const name = overrides.name;
  return {
    name,
    slug: overrides.slug || slugify(name),
    latitude: overrides.latitude,
    longitude: overrides.longitude,
    address: overrides.address,
    total_employees: overrides.total_employees ?? null,
    hiring: overrides.hiring ?? false,
    years_in_business: overrides.years_in_business ?? null,
    best_places_score: overrides.best_places_score ?? null,
    onboarding_note: overrides.onboarding_note ?? null,
    category: overrides.category,
    website: overrides.website || null,
    description: overrides.description,
    logo_url: overrides.logo_url ?? null,
    source_name: overrides.source_name || null,
    source_url: overrides.source_url || null,
    data_status: overrides.data_status || "seeded"
  };
}

// The ten invented "early sample data" businesses that used to be seeded here (example.com websites,
// no source) were removed in November 2026. Only businesses with a real source belong in this file.

const peddlersVillage = [
  ["Moku-Bowls", "Dining", 45],
  ["Buttonwood Grill", "Dining", 16, "https://buttonwoodgrill.com/"],
  ["Cock 'n Bull Restaurant", "Dining", 54],
  ["Red Fox Lounge", "Dining", "54A"],
  ["Earl's New American", "Dining", 15],
  ["Hart's Tavern", "Dining", 51, "https://hartstavern.com/"],
  ["The Lucky Cupcake Company", "Dining", 29],
  ["Fizzy Mama", "Dining", 76],
  ["Frescafe Food Company", "Dining", 7],
  ["Nina's Waffles & Ice Cream", "Dining", 18],
  ["Painted Pony Cafe", "Dining", 166, "https://giggleberryfair.com/painted-pony-cafe/"],
  ["Peddler's Pub", "Dining", 52],
  ["Mama Hawk's Kitchen & Coffee", "Dining", 58],
  ["Artisans Gallery", "Galleries & Artisans", 35],
  ["Lachman Gallery", "Galleries & Artisans", 44],
  ["Lighthouse Galleries", "Galleries & Artisans", "60A"],
  ["Thomas Kinkade Signature Gallery", "Galleries & Artisans", "60B"],
  ["Nissley Vineyards", "Beer, Wine & Spirits", 20],
  ["Free Will Brewing Taproom", "Beer, Wine & Spirits", 47],
  ["Hewn Spirits", "Beer, Wine & Spirits", 42],
  ["Best Gift Idea Ever", "Collectibles & Gifts", 33],
  ["Cigar, Cigars", "Collectibles & Gifts", 3],
  ["The Cloak and Wand", "Collectibles & Gifts", 67],
  ["The Mole Hole", "Collectibles & Gifts", 78],
  ["Pine Wreath & Candle, Ltd.", "Collectibles & Gifts", 70],
  ["Tempus Cards & Gifts", "Collectibles & Gifts", 79],
  ["25 South Luxe", "Fashion & Accessories", 57],
  ["Blake Jewelers", "Fashion & Accessories", 5],
  ["Chico's", "Fashion & Accessories", 72],
  ["Cotton Company", "Fashion & Accessories", 40],
  ["Crush", "Fashion & Accessories", 59],
  ["Divine Jewelers", "Fashion & Accessories", 48],
  ["Fox & Holly", "Fashion & Accessories", 162, "https://www.foxandhollybuckscounty.com/"],
  ["Hats Galore & More", "Fashion & Accessories", 36],
  ["Jewelry Nest Boutique", "Fashion & Accessories", 62],
  ["Lace Silhouettes Lingerie", "Fashion & Accessories", 30],
  ["Not Your Sisters Closet", "Fashion & Accessories", "161A"],
  ["PJ's & Jammies", "Fashion & Accessories", "30A"],
  ["The Snugglebunny Boutique", "Fashion & Accessories", 61],
  ["Sunflowers", "Fashion & Accessories", 41],
  ["Village Outfitters", "Fashion & Accessories", 37],
  ["The Celtic Rose", "International", 14],
  ["Fehrenbach Black Forest Clocks & Gifts", "International", 68],
  ["What's In A Name", "International", 50],
  ["Cookery Ware Shop", "Lifestyle & Home Decor", 66],
  ["Country Accents", "Lifestyle & Home Decor", 39],
  ["Creative Corners", "Lifestyle & Home Decor", 8],
  ["Greenology Organic Living", "Lifestyle & Home Decor", "23A"],
  ["Ice Imports", "Lifestyle & Home Decor", 46],
  ["Journey's Spirited Gifts", "Lifestyle & Home Decor", 81],
  ["Knobs 'N Knockers", "Lifestyle & Home Decor", 22],
  ["Paramount Home Interiors", "Lifestyle & Home Decor", 163],
  ["The Soap Opera Company", "Lifestyle & Home Decor", 23],
  ["The Wooden Duck", "Lifestyle & Home Decor", 1],
  ["Golden Plough Inn", "Lodging", 17, "https://peddlersvillage.com/stay/"],
  ["Bank of America", "Services", 167],
  ["David J. Witchell Salon & Spa", "Services", 56],
  ["Peddler's Village Corporate Office", "Services", "54A", "https://peddlersvillage.com/"],
  ["United States Post Office", "Services", 168],
  ["Visitor & Event Center and Village General Store", "Services", 25],
  ["Bucks County House of Jerky", "Specialty Food & Gifts", 69],
  ["Clusters Handcrafted Popcorn", "Specialty Food & Gifts", 53],
  ["Extra Virgin", "Specialty Food & Gifts", 64],
  ["Pepper Palace", "Specialty Food & Gifts", 161],
  ["Savory Spice Shop", "Specialty Food & Gifts", 32],
  ["Skip's Candy Corner", "Specialty Food & Gifts", 27],
  ["Sticky Situations", "Specialty Food & Gifts", 63],
  ["Sweet Occasions", "Specialty Food & Gifts", 74],
  ["Colt's Sports Collectibles", "Toys, Books & Hobbies", "79A"],
  ["Jazams", "Toys, Books & Hobbies", 160],
  ["The Lahaska Bookshop", "Toys, Books & Hobbies", "162A"],
  ["Pieces", "Toys, Books & Hobbies", 12],
  ["Tails of the Village", "Toys, Books & Hobbies", 19],
  ["The Total Animal", "Toys, Books & Hobbies", 38],
  ["Giggleberry Fair", "Family Fun", 166, "https://giggleberryfair.com/"]
].map(([name, category, shop, website]) =>
  company({
    name,
    slug: `peddlers-village-${slugify(name)}`,
    latitude: PEDDLERS.latitude,
    longitude: PEDDLERS.longitude,
    address: `Shop #${shop}, Peddler's Village, ${PEDDLERS_ADDRESS}`,
    total_employees: null,
    hiring: false,
    years_in_business: null,
    category,
    website: website || "https://peddlersvillage.com/",
    description: `${name} is listed in the Peddler's Village shop directory in Lahaska, PA. Website, hiring, employee count, and onboarding details should be audited before publication as verified employer data.`,
    source_name: "Peddler's Village shop directory PDF, March 2025",
    source_url: PEDDLERS_SOURCE,
    data_status: website ? "seeded-with-website" : "needs-website-audit"
  })
);

const companies = [...peddlersVillage].sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync("companies.json", `${JSON.stringify(companies, null, 2)}\n`);
console.log(`Wrote ${companies.length} companies to companies.json`);
