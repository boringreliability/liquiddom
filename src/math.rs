/// Minimal 2D vector for physics calculations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

impl std::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl std::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

impl std::ops::Mul<f32> for Vec2 {
    type Output = Self;
    fn mul(self, scalar: f32) -> Self {
        Self {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

impl std::ops::AddAssign for Vec2 {
    fn add_assign(&mut self, rhs: Self) {
        self.x += rhs.x;
        self.y += rhs.y;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vec2_math() {
        let a = Vec2::new(3.0, 4.0);
        let b = Vec2::new(1.0, 2.0);

        // Addition
        let sum = a + b;
        assert_eq!(sum, Vec2::new(4.0, 6.0));

        // Subtraction
        let diff = a - b;
        assert_eq!(diff, Vec2::new(2.0, 2.0));

        // Scalar multiplication
        let scaled = a * 2.0;
        assert_eq!(scaled, Vec2::new(6.0, 8.0));

        // Zero
        let z = Vec2::zero();
        assert_eq!(z, Vec2::new(0.0, 0.0));

        // Identity: a + zero = a
        assert_eq!(a + Vec2::zero(), a);
    }
}
