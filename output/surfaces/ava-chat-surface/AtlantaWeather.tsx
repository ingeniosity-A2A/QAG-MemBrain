import React, { useState, useEffect } from 'react';

interface WeatherData {
  temp_f: number;
  condition: string;
  humidity: number;
  wind_mph: number;
  location: string;
}

export const AtlantaWeather: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Surface consumes external API - no direct memory writes
    async function fetchWeather() {
      try {
        const res = await fetch('https://api.weather.gov/gridpoints/FFC/54,52/forecast');
        const data = await res.json();
        const period = data.properties?.periods?.[0];
        if (period) {
          setWeather({
            temp_f: period.temperature || 72,
            condition: period.shortForecast || 'Clear',
            humidity: 55,
            wind_mph: period.windSpeed?.match(/\d+/)?.[0] ? parseInt(period.windSpeed.match(/\d+/)[0]) : 5,
            location: 'Atlanta, GA',
          });
        }
      } catch {
        setWeather({ temp_f: 72, condition: 'Clear', humidity: 55, wind_mph: 5, location: 'Atlanta, GA' });
      } finally {
        setLoading(false);
      }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 300000); // 5 min refresh
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="atlanta-weather">Loading...</div>;
  if (!weather) return null;

  return (
    <div className="atlanta-weather">
      <div className="atlanta-weather__location">{weather.location}</div>
      <div className="atlanta-weather__temp">{weather.temp_f}°F</div>
      <div className="atlanta-weather__condition">{weather.condition}</div>
      <div className="atlanta-weather__details">
        <span>Humidity: {weather.humidity}%</span>
        <span>Wind: {weather.wind_mph} mph</span>
      </div>
    </div>
  );
};
