export interface RescuedAnimalStory {
  id: string;
  name: string;
  species: string;
  imageUrl: string;
  rescuedBy: string;
  rescueDate: string;
  location: string;
  story: string;
  condition: 'Recovered' | 'In Sanctuary' | 'Adopted' | 'Released to Wild';
  badgeColor: string;
}

export const RESCUED_ANIMAL_STORIES: RescuedAnimalStory[] = [
  {
    id: 'rescue-1',
    name: 'Bella',
    species: 'Golden Retriever Mix',
    imageUrl: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
    rescuedBy: 'Paws & Care Wildlife Rescue',
    rescueDate: 'Yesterday',
    location: 'Oakwood Ave & 4th St',
    story: 'Reported with a fractured hind paw near a traffic intersection. Stabilized in 15 minutes and now recovering comfortably.',
    condition: 'Recovered',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  {
    id: 'rescue-2',
    name: 'Oliver',
    species: 'Ginger Kitten',
    imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=800&q=80',
    rescuedBy: 'South District Shelter Team',
    rescueDate: '2 days ago',
    location: 'Pine Street Canal Walk',
    story: 'Stranded inside an open stormwater pipe during rain. Safely extricated and placed in warm foster care.',
    condition: 'Adopted',
    badgeColor: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  {
    id: 'rescue-3',
    name: 'Gauri',
    species: 'Sanctuary Calf',
    imageUrl: 'https://images.unsplash.com/photo-1570042225831-d98fa7577f1e?auto=format&fit=crop&w=800&q=80',
    rescuedBy: 'Metro Emergency Vet Hospital',
    rescueDate: '3 days ago',
    location: 'Sector 9 Canal Road',
    story: 'Stuck in muddy canal embankment. Mobilized a 3-member team with safety harnesses. Now thriving in an open pasture.',
    condition: 'In Sanctuary',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  {
    id: 'rescue-4',
    name: 'Zephyr',
    species: 'Wild Hawk',
    imageUrl: 'https://images.unsplash.com/photo-1552728089-57bdde30beb3?auto=format&fit=crop&w=800&q=80',
    rescuedBy: 'Regional Wildlife Sanctuary',
    rescueDate: '4 days ago',
    location: 'Pine Crest Trailhead',
    story: 'Entangled in nylon wire under pine canopy. Rehabilitated over 48 hours and safely re-released into mountain range.',
    condition: 'Released to Wild',
    badgeColor: 'bg-stone-100 text-stone-800 border-stone-300',
  },
  {
    id: 'rescue-5',
    name: 'Barnaby',
    species: 'Terrier Puppy',
    imageUrl: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=800&q=80',
    rescuedBy: 'Alex Rivera (K9 Volunteer)',
    rescueDate: '5 days ago',
    location: 'Elmwood Bridge Underpass',
    story: 'Dehydrated puppy sheltered from extreme heat. Rehydrated and medically cleared within 1 hour of SOS dispatch.',
    condition: 'Adopted',
    badgeColor: 'bg-teal-100 text-teal-800 border-teal-200',
  },
];

export const ANIMAL_CATEGORY_PRESETS = [
  {
    id: 'dog',
    name: 'Dog / Canine',
    label: 'Injured Dog',
    presetText: 'Dog injured or limping near roadside, needing immediate veterinary check.',
    imageUrl: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=400&q=80',
    illustrationType: 'dog' as const,
  },
  {
    id: 'cat',
    name: 'Cat / Kitten',
    label: 'Stranded Cat',
    presetText: 'Cat or kitten trapped, injured, or stuck in high/dangerous spot.',
    imageUrl: 'https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=400&q=80',
    illustrationType: 'cat' as const,
  },
  {
    id: 'cow',
    name: 'Cow / Farm Animal',
    label: 'Trapped Cow / Cattle',
    presetText: 'Cow or cattle stuck in canal/drain, injured or unable to stand.',
    imageUrl: 'https://images.unsplash.com/photo-1527153857715-3908f2ae5e81?auto=format&fit=crop&w=400&q=80',
    illustrationType: 'cow' as const,
  },
  {
    id: 'bird',
    name: 'Bird / Wildlife',
    label: 'Injured Bird / Hawk',
    presetText: 'Bird with damaged wing or entangled in netting grounded in public area.',
    imageUrl: 'https://images.unsplash.com/photo-1444464666168-49d633b86797?auto=format&fit=crop&w=400&q=80',
    illustrationType: 'bird' as const,
  },
];
