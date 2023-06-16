# supra.ts

supra.ts is a simple library to scrape car make/model and road tax expiry from OneMotoring SG.

## Installation

```bash
npm install supra.ts
```

```bash
yarn add supra.ts
```

## Usage

```typescript
import { Supra } from "supra.ts";

const supra = new Supra();
const { license, carMake, roadTaxExpiry } = await supra.search(PLATE);

```

## Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)
