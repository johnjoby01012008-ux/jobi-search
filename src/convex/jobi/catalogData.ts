/**
 * Curated property catalog.
 *
 * This is the browsable inventory Jobi Search is built around. It is plain data
 * (no Convex imports) so it can be seeded into the `hotels` table, edited by an
 * administrator afterwards, and reused in tests.
 */

export interface CatalogRoom {
  name: string;
  nightlyRate: number;
  mealPlan?: string;
  cancellationPolicy?: string;
  maxGuests?: number;
}

export interface CatalogHotel {
  slug: string;
  name: string;
  destination: string;
  locality: string;
  address: string;
  brand?: string;
  propertyType: string;
  rating: number;
  reviews: number;
  priceFrom: number;
  currency: string;
  imageUrl: string;
  gallery: string[];
  amenities: string[];
  description: string;
  highlights: string[];
  rooms: CatalogRoom[];
  tags: string[];
  featured: boolean;
}

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=70`;

const IMG = {
  exterior: img("photo-1566073771259-6a8506099945"),
  pool: img("photo-1571003123894-1f0594d2b5d9"),
  room: img("photo-1520250497591-112f2f40a3f4"),
  suite: img("photo-1582719508461-905c673771fd"),
  lobby: img("photo-1445019980597-93fa8acb246c"),
  heritage: img("photo-1551882547-ff40c63fe5fa"),
  courtyard: img("photo-1571896349842-33c89424de2d"),
  terrace: img("photo-1590490360182-c33d57733427"),
  riverside: img("photo-1596394516093-501ba68a0ba6"),
  villa: img("photo-1618773928121-c32242e63f39"),
  lobbyWarm: img("photo-1542314831-068cd1dbfeeb"),
  resort: img("photo-1584132967334-10e028bd69f7"),
  city: img("photo-1564501049412-61c2a3083791"),
  minimalist: img("photo-1631049307264-da0ec9d70304"),
};

const FREE_CANCEL = "Free cancellation up to 48 hours before check-in";
const FLEX = "Free cancellation up to 7 days before check-in";
const NON_REFUNDABLE = "Non-refundable";

export const HOTEL_CATALOG: CatalogHotel[] = [
  {
    slug: "verdant-bay-goa",
    name: "Verdant Bay Resort & Spa",
    destination: "Goa",
    locality: "Arossim Beach",
    address: "Arossim Beach Road, South Goa 403712",
    propertyType: "Five-star resort",
    rating: 4.7,
    reviews: 1284,
    priceFrom: 14500,
    currency: "INR",
    imageUrl: IMG.pool,
    gallery: [IMG.pool, IMG.exterior, IMG.suite, IMG.terrace],
    amenities: [
      "Infinity pool",
      "Private beach access",
      "Spa",
      "Fitness centre",
      "Fine dining",
      "Free Wi-Fi",
      "Valet parking",
      "Concierge",
    ],
    description:
      "A low-rise resort set behind a quiet stretch of Arossim Beach, arranged around a shaded courtyard and a long infinity pool. Rooms open onto private terraces, and the spa draws on coastal botanicals. Suited to travellers who want the beach without the crowds.",
    highlights: [
      "Direct access to a sheltered stretch of Arossim Beach",
      "All-day dining with a dedicated Goan kitchen",
      "Adults-only infinity pool alongside a family pool",
    ],
    rooms: [
      { name: "Garden View Room", nightlyRate: 14500, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Pool Terrace Suite", nightlyRate: 21500, mealPlan: "Breakfast and dinner", cancellationPolicy: FREE_CANCEL, maxGuests: 3 },
      { name: "Beachfront Villa", nightlyRate: 32000, mealPlan: "Breakfast and dinner", cancellationPolicy: FLEX, maxGuests: 4 },
    ],
    tags: ["Beachfront", "Spa", "Resort"],
    featured: true,
  },
  {
    slug: "casa-alvor-goa",
    name: "Casa Alvor Boutique Stay",
    destination: "Goa",
    locality: "Assagao",
    address: "Bouta Waddo, Assagao, North Goa 403507",
    propertyType: "Boutique stay",
    rating: 4.5,
    reviews: 412,
    priceFrom: 8200,
    currency: "INR",
    imageUrl: IMG.heritage,
    gallery: [IMG.heritage, IMG.courtyard, IMG.room],
    amenities: ["Outdoor pool", "Free Wi-Fi", "Breakfast included", "Bicycle hire", "Air conditioning", "Parking"],
    description:
      "A restored Portuguese-era house in Assagao with seven rooms, a small courtyard pool and a kitchen that serves a single seasonal menu. Intimate rather than polished, and well placed for the village's restaurants.",
    highlights: ["Seven rooms, each individually furnished", "Courtyard pool framed by frangipani", "Walking distance to Assagao's dining"],
    rooms: [
      { name: "Classic Room", nightlyRate: 8200, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Courtyard Suite", nightlyRate: 11400, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
    ],
    tags: ["Boutique", "Heritage"],
    featured: false,
  },
  {
    slug: "marigold-haveli-jaipur",
    name: "Marigold Haveli",
    destination: "Jaipur",
    locality: "Bani Park",
    address: "Kabir Marg, Bani Park, Jaipur 302016",
    propertyType: "Heritage hotel",
    rating: 4.6,
    reviews: 968,
    priceFrom: 9600,
    currency: "INR",
    imageUrl: IMG.heritage,
    gallery: [IMG.heritage, IMG.courtyard, IMG.lobbyWarm, IMG.room],
    amenities: ["Rooftop restaurant", "Courtyard", "Spa", "Free Wi-Fi", "Airport transfer", "Air conditioning"],
    description:
      "A family-run haveli dating to the 1930s, with hand-painted ceilings and jharokha windows opening over a central courtyard. The rooftop restaurant looks toward Nahargarh Fort, and the old city is a short drive away.",
    highlights: ["Original frescoes across the principal rooms", "Rooftop dining with views to Nahargarh", "Heritage walks arranged by the front desk"],
    rooms: [
      { name: "Heritage Room", nightlyRate: 9600, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Courtyard Suite", nightlyRate: 15800, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 3 },
    ],
    tags: ["Heritage", "Rooftop"],
    featured: true,
  },
  {
    slug: "amber-courtyard-jaipur",
    name: "The Amber Courtyard",
    destination: "Jaipur",
    locality: "Amer",
    address: "Amer Road, Jaipur 302028",
    propertyType: "Boutique hotel",
    rating: 4.4,
    reviews: 336,
    priceFrom: 7100,
    currency: "INR",
    imageUrl: IMG.terrace,
    gallery: [IMG.terrace, IMG.exterior, IMG.courtyard],
    amenities: ["Plunge pool", "Free Wi-Fi", "Breakfast included", "Air conditioning", "Parking", "Concierge"],
    description:
      "A compact hotel built around a stone courtyard a short distance from Amer Fort. Rooms are arranged over two floors, and the terrace is set up for early breakfasts before the fort opens.",
    highlights: ["Ten minutes from the Amer Fort entrance", "Stone courtyard with a plunge pool", "Early breakfast service for fort visits"],
    rooms: [
      { name: "Courtyard Room", nightlyRate: 7100, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Terrace Room", nightlyRate: 10200, mealPlan: "Breakfast included", cancellationPolicy: NON_REFUNDABLE, maxGuests: 2 },
    ],
    tags: ["Boutique", "Historic"],
    featured: false,
  },
  {
    slug: "lakeview-retreat-udaipur",
    name: "Lakeview Retreat",
    destination: "Udaipur",
    locality: "Lake Pichola",
    address: "Rameshwar Ghat, Lake Pichola, Udaipur 313001",
    propertyType: "Five-star hotel",
    rating: 4.8,
    reviews: 1102,
    priceFrom: 18900,
    currency: "INR",
    imageUrl: IMG.lobby,
    gallery: [IMG.lobby, IMG.suite, IMG.resort, IMG.terrace],
    amenities: ["Lake-facing pool", "Spa", "Fine dining", "Rooftop bar", "Free Wi-Fi", "Airport transfer", "Concierge"],
    description:
      "A lakefront property on Rameshwar Ghat, with rooms angled toward the City Palace and Jag Mandir. The rooftop bar is deliberately quiet, and the spa uses a small number of treatment rooms so bookings stay unhurried.",
    highlights: ["Uninterrupted views across Lake Pichola", "Boat transfers to the hotel's private jetty", "Rooftop bar with a short, considered list"],
    rooms: [
      { name: "Lake View Room", nightlyRate: 18900, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Grand Lake Suite", nightlyRate: 28500, mealPlan: "Breakfast and dinner", cancellationPolicy: FLEX, maxGuests: 3 },
    ],
    tags: ["Lakefront", "Spa", "Luxury"],
    featured: true,
  },
  {
    slug: "aravalli-stone-villas-udaipur",
    name: "Aravalli Stone Villas",
    destination: "Udaipur",
    locality: "Bujra",
    address: "Bujra Road, Udaipur 313001",
    propertyType: "Private villas",
    rating: 4.5,
    reviews: 188,
    priceFrom: 12600,
    currency: "INR",
    imageUrl: IMG.villa,
    gallery: [IMG.villa, IMG.minimalist, IMG.pool],
    amenities: ["Private pool", "Kitchenette", "Free Wi-Fi", "Parking", "Garden", "Air conditioning"],
    description:
      "Six detached stone villas on a hillside outside the city, each with its own pool and a kitchenette. Housekeeping visits once daily and breakfast is delivered to the villa, so the stay is largely private.",
    highlights: ["Each villa has a private pool and terrace", "Breakfast delivered to your villa", "Twenty minutes from Udaipur city"],
    rooms: [
      { name: "One-bedroom Villa", nightlyRate: 12600, mealPlan: "Breakfast included", cancellationPolicy: FLEX, maxGuests: 2 },
      { name: "Two-bedroom Villa", nightlyRate: 19800, mealPlan: "Breakfast included", cancellationPolicy: FLEX, maxGuests: 4 },
    ],
    tags: ["Private pool", "Villas", "Quiet"],
    featured: false,
  },
  {
    slug: "deodar-ridge-manali",
    name: "Deodar Ridge Lodge",
    destination: "Manali",
    locality: "Old Manali",
    address: "Log Huts Area, Old Manali 175131",
    propertyType: "Mountain lodge",
    rating: 4.6,
    reviews: 604,
    priceFrom: 8900,
    currency: "INR",
    imageUrl: IMG.riverside,
    gallery: [IMG.riverside, IMG.room, IMG.exterior],
    amenities: ["Mountain-view rooms", "Fireplace lounge", "Free Wi-Fi", "Restaurant", "Parking", "Heating"],
    description:
      "A timber lodge above Old Manali, set among deodar trees with the Beas audible from the lower rooms. The lounge fireplace is lit from October, and the kitchen serves a short mountain menu through the day.",
    highlights: ["Deodar forest on three sides", "Fireplace lounge open through winter", "Fifteen minutes on foot to Old Manali village"],
    rooms: [
      { name: "Valley View Room", nightlyRate: 8900, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Ridge Suite", nightlyRate: 13400, mealPlan: "Breakfast and dinner", cancellationPolicy: FREE_CANCEL, maxGuests: 3 },
    ],
    tags: ["Mountains", "Fireplace", "Family friendly"],
    featured: true,
  },
  {
    slug: "kaveri-estate-coorg",
    name: "Kaveri Estate Retreat",
    destination: "Coorg",
    locality: "Madikeri",
    address: "Kaveri Estate, Madikeri, Coorg 571201",
    propertyType: "Plantation retreat",
    rating: 4.7,
    reviews: 291,
    priceFrom: 11200,
    currency: "INR",
    imageUrl: IMG.resort,
    gallery: [IMG.resort, IMG.terrace, IMG.room],
    amenities: ["Coffee estate walks", "Infinity pool", "Spa", "Free Wi-Fi", "Restaurant", "Parking"],
    description:
      "A working coffee and pepper estate with eight cottages above the cultivation line. Mornings begin with an estate walk led by the resident planter, and the pool looks out over the valley.",
    highlights: ["Guided estate walk every morning", "Eight cottages, no two the same", "Coffee tasting in the roasting room"],
    rooms: [
      { name: "Estate Cottage", nightlyRate: 11200, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Valley Cottage", nightlyRate: 15600, mealPlan: "All meals", cancellationPolicy: FLEX, maxGuests: 3 },
    ],
    tags: ["Plantation", "Nature", "Spa"],
    featured: false,
  },
  {
    slug: "harbour-lights-kochi",
    name: "Harbour Lights Heritage Hotel",
    destination: "Kochi",
    locality: "Fort Kochi",
    address: "Princess Street, Fort Kochi 682001",
    propertyType: "Heritage hotel",
    rating: 4.5,
    reviews: 517,
    priceFrom: 8400,
    currency: "INR",
    imageUrl: IMG.lobbyWarm,
    gallery: [IMG.lobbyWarm, IMG.heritage, IMG.courtyard],
    amenities: ["Courtyard restaurant", "Free Wi-Fi", "Air conditioning", "Library", "Concierge", "Airport transfer"],
    description:
      "A Dutch-era warehouse on Princess Street converted into fourteen rooms around a planted courtyard. The restaurant serves a largely Keralan menu, and the Chinese fishing nets are a short walk away.",
    highlights: ["Fourteen rooms in a restored Dutch-era building", "Courtyard restaurant with a Keralan menu", "Two minutes from Princess Street's galleries"],
    rooms: [
      { name: "Heritage Room", nightlyRate: 8400, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Courtyard Suite", nightlyRate: 12900, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 3 },
    ],
    tags: ["Heritage", "City centre"],
    featured: false,
  },
  {
    slug: "marine-crest-mumbai",
    name: "Marine Crest Hotel",
    destination: "Mumbai",
    locality: "Marine Drive",
    address: "Marine Drive, Churchgate, Mumbai 400020",
    propertyType: "Business hotel",
    rating: 4.4,
    reviews: 1476,
    priceFrom: 13200,
    currency: "INR",
    imageUrl: IMG.city,
    gallery: [IMG.city, IMG.minimalist, IMG.lobby],
    amenities: ["Bay-view rooms", "Fitness centre", "Business centre", "Free Wi-Fi", "Restaurant", "Valet parking"],
    description:
      "A purpose-built hotel on Marine Drive with rooms facing the bay and a floor set aside for meetings. Service is efficient rather than ceremonial, and the restaurant opens early for breakfast from six.",
    highlights: ["Bay-facing rooms on the upper floors", "Meeting rooms bookable by the hour", "Walk to Nariman Point and Churchgate station"],
    rooms: [
      { name: "City View Room", nightlyRate: 13200, mealPlan: "Room only", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Bay View Room", nightlyRate: 17800, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
    ],
    tags: ["City centre", "Business"],
    featured: false,
  },
  {
    slug: "ganga-bend-rishikesh",
    name: "Ganga Bend Riverside Resort",
    destination: "Rishikesh",
    locality: "Tapovan",
    address: "Tapovan, Rishikesh 249192",
    propertyType: "Riverside resort",
    rating: 4.6,
    reviews: 733,
    priceFrom: 7600,
    currency: "INR",
    imageUrl: IMG.riverside,
    gallery: [IMG.riverside, IMG.resort, IMG.room],
    amenities: ["River access", "Yoga deck", "Ayurvedic spa", "Free Wi-Fi", "Restaurant", "Parking"],
    description:
      "A riverside property at the quieter end of Tapovan, with a yoga deck above the water and a small Ayurvedic spa. Rooms are simple and well kept; the river does most of the work.",
    highlights: ["Private steps down to the Ganga", "Morning and evening yoga on the deck", "Vegetarian kitchen throughout"],
    rooms: [
      { name: "Garden Room", nightlyRate: 7600, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "River View Room", nightlyRate: 10800, mealPlan: "All meals", cancellationPolicy: FREE_CANCEL, maxGuests: 3 },
    ],
    tags: ["Riverside", "Wellness"],
    featured: false,
  },
  {
    slug: "palolem-shore-goa",
    name: "Palolem Shore Cottages",
    destination: "Goa",
    locality: "Palolem",
    address: "Palolem Beach, Canacona, South Goa 403702",
    propertyType: "Beach cottages",
    rating: 4.3,
    reviews: 559,
    priceFrom: 6400,
    currency: "INR",
    imageUrl: IMG.exterior,
    gallery: [IMG.exterior, IMG.room, IMG.pool],
    amenities: ["Beach frontage", "Restaurant", "Free Wi-Fi", "Bicycle hire", "Air conditioning"],
    description:
      "A row of timber cottages set back from Palolem's northern curve, shaded by coconut palms. The kitchen serves Goan and continental food until late, and kayaks are kept on the beach.",
    highlights: ["Cottages set back from the main beach entry", "Kayaks and paddleboards on request", "Kitchen open until midnight"],
    rooms: [
      { name: "Garden Cottage", nightlyRate: 6400, mealPlan: "Breakfast included", cancellationPolicy: FREE_CANCEL, maxGuests: 2 },
      { name: "Beachfront Cottage", nightlyRate: 9800, mealPlan: "Breakfast included", cancellationPolicy: NON_REFUNDABLE, maxGuests: 3 },
    ],
    tags: ["Beachfront", "Value"],
    featured: false,
  },
];

export const CATALOG_DESTINATIONS = Array.from(
  new Set(HOTEL_CATALOG.map((hotel) => hotel.destination)),
).sort();

/** The single hotel used to demonstrate the flow when the table is empty. */
export const FEATURED_SLUGS = HOTEL_CATALOG.filter((hotel) => hotel.featured).map(
  (hotel) => hotel.slug,
);
