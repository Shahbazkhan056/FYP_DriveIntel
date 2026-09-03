import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';

interface HealthGaugeProps {
  score: number;
  size?: number;
}

const HealthGauge: React.FC<HealthGaugeProps> = ({ score, size = 80 }) => {
  const { colors } = useTheme();
  const strokeWidth = 7;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - score / 100);
  const center = size / 2;

  const getColor = () => {
    if (score >= 80) return colors.healthy;
    if (score >= 50) return colors.warning;
    return colors.critical;
  };

  const color = getColor();

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={center} cy={center} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="transparent" />
          <Circle
            cx={center} cy={center} r={radius}
            stroke={color} strokeWidth={strokeWidth} fill="transparent"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round" rotation="-90" origin={`${center},${center}`}
          />
        </Svg>
        <View style={[styles.center, { width: size, height: size }]}>
          <Text style={[styles.value, { color }]}>{score}%</Text>
        </View>
      </View>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Health</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  value:  { fontSize: 16, fontWeight: '700' },
  label:  { fontSize: 12, marginTop: 6 },
});

export default HealthGauge;
