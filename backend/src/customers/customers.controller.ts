import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchCustomersQueryDto } from './dto/search-customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  search(@Query() q: SearchCustomersQueryDto) {
    return this.customers.search(q.search, q.limit ?? 10);
  }
}
