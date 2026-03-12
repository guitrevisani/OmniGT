export function computeDashboard({ daily }) {

  return {
    daily: daily.map(d => ({
      day: d.activity_date,
      distance_m: d.total_distance_m,
      moving_time: d.total_moving_time_sec,
      elevation: d.total_elevation_gain_m
    }))
  }

}
