import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';

interface CircularGaugeProps {
  value: number;
  maxValue: number;
  label: string;
  unit: string;
  color: string;
  size?: number;
}

const CircularGauge: React.FC<CircularGaugeProps> = ({
  value, maxValue, label, unit, color, size = 110,
}) => {
  const { colors } = useTheme();
  const strokeWidth = 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(value / maxValue, 1));
  const center = size / 2;

  return (
    <View style={styles.container}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={center} cy={center} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="transparent" />
          <Circle
            cx={center} cy={center} r={radius}
            stroke={color} strokeWidth={strokeWidth} fill="transparent"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round" rotation="-90" origin={`${center}, ${center}`}
          />
        </Svg>
        <View style={[styles.centerContent, { width: size, height: size }]}>
          <Text style={[styles.value, { color }]}>{value}</Text>
          <Text style={[styles.unit, { color }]}>{unit}</Text>
        </View>
      </View>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container:     { alignItems: 'center', marginBottom: 8 },
  centerContent: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  value:         { fontSize: 22, fontWeight: '700', lineHeight: 26 },
  unit:          { fontSize: 11, fontWeight: '500', opacity: 0.85 },
  label:         { fontSize: 13, marginTop: 8, fontWeight: '500' },
});

export default CircularGauge;
