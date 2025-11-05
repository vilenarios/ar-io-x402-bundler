"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.W = exports.Winston = void 0;
/**
 * Copyright (C) 2022-2024 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const bignumber_js_1 = require("bignumber.js");
class Winston {
    constructor(amount) {
        this.amount = new bignumber_js_1.BigNumber(amount);
        if (this.amount.isLessThan(0) || !this.amount.isInteger()) {
            throw new Error("Winston value should be a non-negative integer!");
        }
    }
    plus(winston) {
        return W(this.amount.plus(winston.amount));
    }
    minus(winston) {
        return W(this.amount.minus(winston.amount));
    }
    times(multiplier) {
        return W(this.amount.times(multiplier).decimalPlaces(0, bignumber_js_1.BigNumber.ROUND_DOWN));
    }
    dividedBy(divisor, round = "ROUND_CEIL") {
        // TODO: Best rounding strategy? Up or down?
        return W(this.amount
            .dividedBy(divisor)
            .decimalPlaces(0, round === "ROUND_DOWN" ? bignumber_js_1.BigNumber.ROUND_DOWN : bignumber_js_1.BigNumber.ROUND_CEIL));
    }
    isGreaterThan(winston) {
        return this.amount.isGreaterThan(winston.amount);
    }
    isGreaterThanOrEqualTo(winston) {
        return this.amount.isGreaterThanOrEqualTo(winston.amount);
    }
    static difference(a, b) {
        return a.amount.minus(b.amount).toString();
    }
    toString() {
        return this.amount.toFixed();
    }
    valueOf() {
        return this.amount.toFixed();
    }
    toJSON() {
        return this.toString();
    }
    static max(...winstons) {
        bignumber_js_1.BigNumber.max();
        return winstons.reduce((max, next) => next.amount.isGreaterThan(max.amount) ? next : max);
    }
}
exports.Winston = Winston;
function W(amount) {
    return new Winston(amount);
}
exports.W = W;
