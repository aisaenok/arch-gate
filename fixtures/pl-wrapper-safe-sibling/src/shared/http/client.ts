export async function get(url: string) {
  const response = await fetch(url);
  return response.json();
}

export function formatApplicationId(id: string) {
  return `application:${id}`;
}
